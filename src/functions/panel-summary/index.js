const { app } = require("@azure/functions");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const Common = require("../../../common");

const executeFunctionLogic = async (req, context) => {
  try {
    // prepare params
    const params = [req.req_query.deviceId];
    const predicates = [`vns.device_id = $1`];

    // Handling 'start' and 'end' parameters with preference to 'start'
    if (req.req_query.start) {
      const startTime = Math.floor(
        new Date(req.req_query.start).getTime() / 1000
      );
      params.push(startTime);
      predicates.push(`vns.local_utc_timestamp >= $${params.length}`);
    } else if (req.req_query.since && Number.isFinite(+req.req_query.since)) {
      params.push(+req.req_query.since);
      predicates.push(`vns.local_utc_timestamp >= $${params.length}`);
    }

    if (req.req_query.end) {
      const endTime = Math.floor(new Date(req.req_query.end).getTime() / 1000);
      params.push(endTime);
      predicates.push(`vns.local_utc_timestamp <= $${params.length}`);
    }
    // This query can return a massive amount of rows. Set a reasonable limit as a default.
    const limit = Number.isFinite(+req.req_query?.count)
      ? +req.req_query.count
      : 10000;
    params.push(limit);

    let query;
    const bucketMinutes = Number.isFinite(+req.req_query?.bucketMinutes)
      ? +req.req_query.bucketMinutes
      : null;

    if (bucketMinutes && bucketMinutes > 0) {
      query = `
    SELECT
      EXTRACT(EPOCH FROM "time") AS unixtime,
      *
    FROM (
      SELECT
        time_bucket('${bucketMinutes} minutes', to_timestamp(vns.local_utc_timestamp)) AS "time",
        vns.device_id AS "deviceId",
        vns.modbus_id AS "modbusId",
        AVG(vns.humidity::numeric / 10.0) AS humidity,
        AVG(vns.temperature::numeric / 10.00 * 9.0 / 5.0 + 32.0) AS "tempF",
        SUM(vns.cycles_v1) AS v1cycles,
        SUM(vns.cycles_v2) AS v2cycles,
        SUM(vns.cycles_v3) AS v3cycles,
        SUM(vns.cycles_v4) AS v4cycles,
        SUM(vns.cycles_v5) AS v5cycles,
        SUM(vns.cycles_v6) AS v6cycles,
        SUM(vns.cycles_v7) AS v7cycles,
        SUM(vns.jiffys_active_v1::numeric / 100.0) AS v1secs,
        SUM(vns.jiffys_active_v2::numeric / 100.0) AS v2secs,
        SUM(vns.jiffys_active_v3::numeric / 100.0) AS v3secs,
        SUM(vns.jiffys_active_v4::numeric / 100.0) AS v4secs,
        SUM(vns.jiffys_active_v5::numeric / 100.0) AS v5secs,
        SUM(vns.jiffys_active_v6::numeric / 100.0) AS v6secs,
        SUM(vns.jiffys_active_v7::numeric / 100.0) AS v7secs,
        SUM(vns.elapsed_ds::numeric / 10.0) AS "elapsedSecs"
      FROM valvenode_summary vns
      WHERE ${predicates.join(" AND ")}
      GROUP BY "time", "deviceId", "modbusId"
      ORDER BY "time" DESC
      LIMIT $${params.length}
    ) AS result
    `;
    } else {
      query = `
      SELECT 
        vns.local_utc_timestamp AS unixtime,
        to_timestamp(vns.local_utc_timestamp)::timestamptz AS "time",
        vns.device_id AS "deviceId",
        vns.modbus_id AS "modbusId",
        (vns.humidity::numeric / 10.0)::numeric(8,1) AS humidity,
        round(vns.temperature::numeric / 10.00 * 9.0 / 5.0 + 32.0, 1)::numeric(8,1) AS "tempF",
        vns.cycles_v1 AS v1cycles,
        vns.cycles_v2 AS v2cycles,
        vns.cycles_v3 AS v3cycles,
        vns.cycles_v4 AS v4cycles,
        vns.cycles_v5 AS v5cycles,
        vns.cycles_v6 AS v6cycles,
        vns.cycles_v7 AS v7cycles,
        (vns.jiffys_active_v1::numeric / 100.0)::numeric(9,2) AS v1secs,
        (vns.jiffys_active_v2::numeric / 100.0)::numeric(9,2) AS v2secs,
        (vns.jiffys_active_v3::numeric / 100.0)::numeric(9,2) AS v3secs,
        (vns.jiffys_active_v4::numeric / 100.0)::numeric(9,2) AS v4secs,
        (vns.jiffys_active_v5::numeric / 100.0)::numeric(9,2) AS v5secs,
        (vns.jiffys_active_v6::numeric / 100.0)::numeric(9,2) AS v6secs,
        (vns.jiffys_active_v7::numeric / 100.0)::numeric(9,2) AS v7secs,
        (vns.elapsed_ds::numeric / 10.0)::numeric(8,1) AS "elapsedSecs"
      FROM valvenode_summary vns
      WHERE ${predicates.join(" AND ")}
      ORDER BY vns.local_utc_timestamp DESC
      LIMIT $${params.length}
    `;
    }

    const result = await db.tsdbQuery(query, params);
    const out = result.rows.map((row) => ({ ...row, bucketMinutes }));

    return out;
  } catch (error) {
    return ErrorHandler.prepareResponse(context, error);
  }
};

app.http("panel-summary", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      // Validate input.
      const validator = new Validator(req.req_query, {
        deviceId: "required|alpha_dash",
        since: "integer",
        start: "iso8601",
        end: "iso8601",
        count: "integer",
        bucketMinutes: "integer",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Ensure that the authorized user is allowed to see this particular device ID.
      await Auth.canAccessDevice(req.req_query.deviceId, authorizedUser, db);
      const out = await executeFunctionLogic(req, context);
      return {
        body: JSON.stringify(out),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});

app.http("panel-summary-data", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      // Validate input.
      const validator = new Validator(req.req_query, {
        deviceId: "required|alpha_dash",
        since: "integer",
        start: "iso8601",
        end: "iso8601",
        count: "integer",
        bucketMinutes: "integer",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      const out = await executeFunctionLogic(req, context);
      return {
        body: JSON.stringify(out),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
