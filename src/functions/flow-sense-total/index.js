const { app } = require("@azure/functions");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const Common = require("../../../common");

app.http("flow-sense-total", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Authenticate and authorize the user
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true, // Adjust based on your auth requirements
      });

      // Validate input
      const validator = new Validator(req.query, {
        gatewayId: "string|required",
        deviceId: "string", // Not required, as we may want to query all devices, even though for flow-sense there should only ever be one per location
        bucketMinutes: "integer|required", // To aggregate data https://docs.timescale.com/use-timescale/latest/time-buckets/
        start: "iso8601",
        end: "iso8601",
        dev: "boolean",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Ensure the user has access to the requested data
      await Auth.canAccessDevice(req.query.gatewayId, authorizedUser, db);

      let out = []; // For collecting the output later

      // Prepare parameters for SQL query
      const params = [];
      const predicates = [];

      const defaultStart = new Date(
        new Date(new Date().setDate(new Date().getDate() - 14)).setHours(
          0,
          0,
          0,
          0
        )
      ).toISOString();

      // no if as this is required
      predicates.push(`"gateway_id" = $${params.length + 1}`);
      params.push(req.query.gatewayId);

      if (req.query.deviceId) {
        predicates.push(`"device_id" = $${params.length + 1}`);
        params.push(req.query.deviceId);
      }
      if (req.query.start) {
        predicates.push(`time >= $${params.length + 1}::timestamptz`);
        params.push(req.query.start);
      } else {
        predicates.push(`time >= $${params.length + 1}::timestamptz`);
        params.push(defaultStart); // default to 14 days ago
      }
      if (req.query.end) {
        predicates.push(`time <= $${params.length + 1}::timestamptz`);
        params.push(req.query.end);
      }

      const query = `
      SELECT
        time_str AS time, -- undoing the rename from the subquery
        device_id,
        type,
        value
      FROM (
        SELECT
          time_bucket('${
            req.query.bucketMinutes
          } minutes', time) AS time_str, -- have to rename or grouping is messed up
          device_id,
          type,
          ROUND(SUM(value)::NUMERIC,2) AS value -- total gallons per minute over the bucketed period
        FROM
          water_flow
        WHERE
          ${predicates.join(" AND ")}
          AND type IN ('main_pulse', 'reclaim_pulse', 'other_pulse')
        GROUP BY time_str, device_id, type
        ORDER BY time_str DESC
      ) result
    `;

      // context.log(query);
      let result = await db.tsdbQuery(query, params);

      if (result.rows.length === 0) {
        // ... and the query returned no data...
        context.log("No data found");
        if (req.query.dev) {
          // If we're in dev mode...
          context.log(
            "We're in dev mode, so we'll return some fake data instead."
          );
          // ...build some fake data
          const fakeDataParams = [];
          const fakeMacAddress = Common.generateRandomMac();

          // no if as this is required
          fakeDataParams.push(fakeMacAddress);

          if (req.query?.start) {
            fakeDataParams.push(req.query.start);
          } else {
            fakeDataParams.push(defaultStart); // default to 14 days ago
          }
          if (req.query?.end) {
            fakeDataParams.push(req.query.end);
          } else {
            const defaultEnd = new Date().toISOString();
            fakeDataParams.push(defaultEnd); // default to now
          }

          context.log(fakeDataParams);

          result = await db.tsdbQuery(
            `
          SELECT
            *,
            $1 AS device_id
          FROM (
            SELECT
              time,
              'main_pulse' AS type,
              CASE
                WHEN 
                  EXTRACT(HOUR FROM time) >= 12     -- after 6am CST
                    OR EXTRACT(HOUR FROM time) <= 4 -- before 10pm CST
                  THEN ROUND((42 * ${+req.query
                    .bucketMinutes} + (random() * 6 - 3))::NUMERIC,2)
                  ELSE ROUND((1 + (random() * 2 - 1))::NUMERIC,2)
                END as value
            FROM generate_series(
              $2::timestamptz,  -- start_date
              $3::timestamptz,  -- end_date
              INTERVAL '${+req.query.bucketMinutes} minutes'
            ) AS time
            UNION ALL
            SELECT
              time,
              'reclaim_pulse' AS type,
              CASE
                WHEN 
                  EXTRACT(HOUR FROM time) >= 12     -- after 6am CST
                    OR EXTRACT(HOUR FROM time) <= 4 -- before 10pm CST
                  THEN ROUND((58 * ${+req.query
                    .bucketMinutes} + (random() * 6 - 3))::NUMERIC,2)
                  ELSE ROUND((1 + (random() * 2 - 1))::NUMERIC,2)
                END as value
            FROM generate_series(
              $2::timestamptz,  -- start_date
              $3::timestamptz,  -- end_date
              INTERVAL '${+req.query.bucketMinutes} minutes'
            ) AS time
          ) AS result
          ORDER BY time
        `,
            fakeDataParams
          );
        }
      }

      // context.log(out);
      out = result.rows;
      context.log(out.length + " rows returned");

      return {
        body: JSON.stringify(out),
      };
    } catch (error) {
      // Handle errors
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
