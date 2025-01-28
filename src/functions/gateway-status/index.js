const { app } = require("@azure/functions");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const Common = require("../../../common");

const executeFunctionLogic = async (req, context) => {
  try {
    // prepare params
    const params = [req.query.deviceId];
    const predicates = [`gs.device_id = $1`];

    // Handling 'start' and 'end' parameters with preference to 'start' and converting ISO8601 to unix timestamp
    if (req.query.start) {
      const startTime = Math.floor(new Date(req.query.start).getTime() / 1000);
      predicates.push(`gs.unixtime >= $${params.length + 1}`);
      params.push(startTime);
    } else if (req.query.since && Number.isFinite(+req.query.since)) {
      predicates.push(`gs.unixtime >= $${params.length + 1}`);
      params.push(+req.query.since);
    }

    if (req.query.end) {
      const endTime = Math.floor(new Date(req.query.end).getTime() / 1000);
      predicates.push(`gs.unixtime <= $${params.length + 1}`);
      params.push(endTime);
    }

    // This query can return a massive amount of rows. Set a reasonable limit as a default.
    const limit = Number.isFinite(+req.query?.count) ? +req.query.count : 10000; // default to 10000
    params.push(limit);

    const bucketMinutes = Number.isFinite(+req.query?.bucketMinutes)
      ? +req.query.bucketMinutes
      : null;

    let query;
    if (bucketMinutes && bucketMinutes > 0) {
      query = `
    SELECT
      EXTRACT(EPOCH FROM "time") AS unixtime,
      *
    FROM (
      SELECT
        time_bucket('${bucketMinutes} minutes', to_timestamp(gs.unixtime)) AS "time",
        gs.device_id AS "deviceId",
        AVG(gs.cpu_load_1::numeric / 10.0)::numeric(8,1) AS "cpuLoad1",
        AVG(gs.cpu_load_5::numeric / 10.0)::numeric(8,1) AS "cpuLoad5",
        AVG(gs.cpu_load_15::numeric / 10.0)::numeric(8,1) AS "cpuLoad15",
        AVG(gs.pct_memory_used::numeric / 100.0)::numeric(8,2) AS "pctMemoryUsed",
        AVG(gs.disk_size)::integer AS "diskSize",
        AVG(gs.disk_capacity)::integer AS "diskCapacity",
        MAX(gs.uptime) AS "uptime"
    FROM gateway_status gs
    WHERE ${predicates.join(" AND ")}
    GROUP BY "time", "deviceId"
    ORDER BY "time" DESC
    LIMIT $${params.length}
    ) AS result
    `;
    } else {
      query = `
      SELECT
        gs.unixtime,
        to_timestamp(gs.unixtime) AS "time",
        gs.device_id AS "deviceId",
        (gs.cpu_load_1::numeric / 10.0)::numeric(8,1) AS "cpuLoad1",
        (gs.cpu_load_5::numeric / 10.0)::numeric(8,1) AS "cpuLoad5",
        (gs.cpu_load_15::numeric / 10.0)::numeric(8,1) AS "cpuLoad15",
        (gs.pct_memory_used::numeric / 100.0)::numeric(8,2) AS "pctMemoryUsed",
        gs.disk_size AS "diskSize",
        gs.disk_capacity AS "diskCapacity",
        gs.uptime
      FROM gateway_status gs
      WHERE ${predicates.join(" AND ")}
      ORDER BY gs.unixtime DESC
      LIMIT $${params.length}
    `;
    }
    // context.log(query, params);
    const result = await db.tsdbQuery(query, params);
    // context.log(result.rows);
    const out = result.rows.map((row) => ({ ...row, bucketMinutes }));

    return out;
  } catch (error) {
    return ErrorHandler.prepareResponse(context, error);
  }
};

app.http("gateway-status", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      // Validate input.
      const validator = new Validator(req.query, {
        deviceId: "required|alpha_dash",
        since: "integer",
        count: "integer",
        start: "iso8601",
        end: "iso8601",
        bucketMinutes: "integer",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Ensure that the authorized user is allowed to see this particular device ID.
      await Auth.canAccessDevice(req.query.deviceId, authorizedUser, db);

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

app.http("gateway-status-data", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      // Validate input.
      const validator = new Validator(req.query, {
        deviceId: "required|alpha_dash",
        since: "integer",
        count: "integer",
        start: "iso8601",
        end: "iso8601",
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
