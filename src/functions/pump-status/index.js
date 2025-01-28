const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

const executeFunctionLogic = async (req, context) => {
  try {
    // prepare params
    const params = [req.query.deviceId];
    const predicates = [`ps.device_id = $1`];

    // Convert start and end from ISO8601 to unix timestamp and add to predicates
    if (req.query.start) {
      const startTime = Math.floor(new Date(req.query.start).getTime() / 1000);
      predicates.push(`ps.local_utc_timestamp >= $${params.length + 1}`);
      params.push(startTime);
    } else if (req.query.since) {
      predicates.push(`ps.local_utc_timestamp >= $${params.length + 1}`);
      params.push(+req.query.since);
    }

    if (req.query.end) {
      const endTime = Math.floor(new Date(req.query.end).getTime() / 1000);
      predicates.push(`ps.local_utc_timestamp <= $${params.length + 1}`);
      params.push(endTime);
    }

    // This query can return a massive amount of rows. Set a reasonable limit as a default.
    const limit = Number.isFinite(+req.query?.count) ? +req.query.count : 10000;
    params.push(limit);

    let query;
    const bucketMinutes = Number.isFinite(+req.query?.bucketMinutes)
      ? +req.query.bucketMinutes
      : null;

    if (bucketMinutes && bucketMinutes > 0) {
      query = `
    SELECT
      EXTRACT(EPOCH FROM "time") AS unixtime,
      *
    FROM (
      SELECT
        time_bucket('${bucketMinutes} minutes', to_timestamp(ps.local_utc_timestamp)) AS "time",
        device_id AS "deviceId",
        modbus_id AS "modbusId",
        AVG(ps.rpm)::numeric(8,1) AS rpm,
        (AVG(ps.amps) / 10.0)::numeric(8,1) AS amps,
        (AVG(ps.watts) / 10.0)::numeric(8,1) AS watts,
        (AVG(ps.freq_conv_temp) / 10.0)::numeric(8,1) AS "freqConvTemp",
        (AVG(ps.elec_temp) / 10.0)::numeric(8,1) AS "electronicsTemp",
        (AVG(ps.outlet_pressure) / 100.0)::numeric(9,2) AS "outletPressure",
        (AVG(ps.freq) / 10.0)::numeric(8,1) AS frequency
      FROM pump_status ps
      WHERE ${predicates.join(" AND ")}
      GROUP BY "time", device_id, modbus_id
      ORDER BY "time" DESC
      LIMIT $${params.length}
    ) AS result
    `;
    } else {
      query = `
    SELECT
      ps.local_utc_timestamp AS unixtime,
      to_timestamp(ps.local_utc_timestamp)::timestamptz AS "time",
      ps.device_id AS "deviceId",
      ps.modbus_id AS "modbusId",
      ps.rpm,
      (ps.amps::numeric / 10.0)::numeric(8,1) AS amps,
      (ps.watts::numeric / 10.0)::numeric(8,1) AS watts,
      (ps.freq_conv_temp::numeric / 10.0)::numeric(8,1) AS "freqConvTemp",
      (ps.elec_temp::numeric / 10.0)::numeric(8,1) AS "electronicsTemp",
      (ps.outlet_pressure::numeric / 100.0)::numeric(9,2) AS "outletPressure",
      (ps.freq::numeric / 10.0)::numeric(8,1) AS frequency
    FROM pump_status ps
    WHERE ${predicates.join(" AND ")}
    ORDER BY ps.local_utc_timestamp DESC
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

app.http("pump-status", {
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
        start: "iso8601",
        end: "iso8601",
        count: "integer",
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

app.http("pump-status-data", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      // Validate input.
      const validator = new Validator(req.query, {
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
