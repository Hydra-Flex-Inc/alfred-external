const { app } = require("@azure/functions");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const Common = require("../../../common");

const getFlowSenseData = async (req, context) => {
  try {
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
    params.push(req.req_query.gatewayId);

    if (req.req_query.deviceId) {
      predicates.push(`"device_id" = $${params.length + 1}`);
      params.push(req.req_query.deviceId);
    }
    if (req.req_query.start) {
      predicates.push(`time >= $${params.length + 1}::timestamptz`);
      params.push(req.req_query.start);
    } else {
      predicates.push(`time >= $${params.length + 1}::timestamptz`);
      params.push(defaultStart); // default to 14 days ago
    }
    if (req.req_query.end) {
      predicates.push(`time <= $${params.length + 1}::timestamptz`);
      params.push(req.req_query.end);
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
            req.req_query.bucketMinutes
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
      if (req.req_query.dev) {
        // If we're in dev mode...
        context.log(
          "We're in dev mode, so we'll return some fake data instead."
        );
        // ...build some fake data
        const fakeDataParams = [];
        const fakeMacAddress = Common.generateRandomMac();

        // no if as this is required
        fakeDataParams.push(fakeMacAddress);

        if (req.req_query?.start) {
          fakeDataParams.push(req.req_query.start);
        } else {
          fakeDataParams.push(defaultStart); // default to 14 days ago
        }
        if (req.req_query?.end) {
          fakeDataParams.push(req.req_query.end);
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
                  THEN ROUND((42 * ${+req.req_query
                    .bucketMinutes} + (random() * 6 - 3))::NUMERIC,2)
                  ELSE ROUND((1 + (random() * 2 - 1))::NUMERIC,2)
                END as value
            FROM generate_series(
              $2::timestamptz,  -- start_date
              $3::timestamptz,  -- end_date
              INTERVAL '${+req.req_query.bucketMinutes} minutes'
            ) AS time
            UNION ALL
            SELECT
              time,
              'reclaim_pulse' AS type,
              CASE
                WHEN 
                  EXTRACT(HOUR FROM time) >= 12     -- after 6am CST
                    OR EXTRACT(HOUR FROM time) <= 4 -- before 10pm CST
                  THEN ROUND((58 * ${+req.req_query
                    .bucketMinutes} + (random() * 6 - 3))::NUMERIC,2)
                  ELSE ROUND((1 + (random() * 2 - 1))::NUMERIC,2)
                END as value
            FROM generate_series(
              $2::timestamptz,  -- start_date
              $3::timestamptz,  -- end_date
              INTERVAL '${+req.req_query.bucketMinutes} minutes'
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
      headers: {
        "Content-Type": "application/json",
      },
    };
  } catch (error) {
    return ErrorHandler.prepareResponse(context, error);
  }
};

app.http("flow-sense-total-data", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      // Validate input
      const validator = new Validator(req.req_query, {
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

      const flowSenseData = await getFlowSenseData(req, context);
      return { ...flowSenseData };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});

app.http("flow-sense-total", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req, context);
      // Authenticate and authorize the user
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true, // Adjust based on your auth requirements
      });

      // Validate input
      const validator = new Validator(req.req_query, {
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
      await Auth.canAccessDevice(req.req_query.gatewayId, authorizedUser, db);

      const flowSenseData = await getFlowSenseData(req, context);
      return { ...flowSenseData };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
