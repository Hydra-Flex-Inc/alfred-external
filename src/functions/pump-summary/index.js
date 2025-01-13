const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

app.http("pump-summary", {
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
        since: "integer", // This will be used if start is not provided
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

      // prepare params
      const params = [req.query.deviceId];
      const predicates = [`ps.device_id = $1`];

      if (req.query.start) {
        const startTime = Math.floor(
          new Date(req.query.start).getTime() / 1000
        );
        predicates.push(`ps.local_utc_timestamp >= $${params.length + 1}`);
        params.push(startTime);
      } else if (
        req.query.since &&
        Number.isFinite(parseInt(req.query.since))
      ) {
        predicates.push(`ps.local_utc_timestamp >= $${params.length + 1}`);
        params.push(parseInt(req.query.since));
      }

      if (req.query.end) {
        const endTime = Math.floor(new Date(req.query.end).getTime() / 1000);
        predicates.push(`ps.local_utc_timestamp <= $${params.length + 1}`);
        params.push(endTime);
      }

      const limit = Number.isFinite(+req.query?.count)
        ? +req.query.count
        : 10000;
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
          time_bucket('${bucketMinutes} minutes', to_timestamp(ps.local_utc_timestamp)) AS "time",
          ps.device_id AS "deviceId",
          ps.modbus_id AS "modbusId",
          AVG((ps.rel_perf::numeric / 100.0))::numeric(9,2) AS "relativePerformance",
          AVG((ps.actual_setpoint::numeric / 100.0))::numeric(9,2) AS "actualSetpoint",
          AVG((ps.user_setpoint::numeric / 100.0))::numeric(9,2) AS "userSetpoint",
          AVG((ps.max_flow_limit::numeric / 10.0))::numeric(8,1) AS "maxFlowLimit",
          AVG((ps.dc_voltage::numeric / 10.0))::numeric(8,1) AS "dcVoltage",
          MAX(ps.run_time) AS "runTime",
          MAX(ps.on_time) AS "onTime",
          MAX(ps.total_kwh) AS "totalKWH",
          MAX(ps.starts) AS "starts"
        FROM pump_summary ps
        WHERE ${predicates.join(" AND ")}
        GROUP BY "time", "deviceId", "modbusId"
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
          (ps.rel_perf::numeric / 100.0)::numeric(9,2) AS "relativePerformance",
          (ps.actual_setpoint::numeric / 100.0)::numeric(9,2) AS "actualSetpoint",
          (ps.user_setpoint::numeric / 100.0)::numeric(9,2) AS "userSetpoint",
          (ps.max_flow_limit::numeric / 10.0)::numeric(8,1) AS "maxFlowLimit",
          (ps.dc_voltage::numeric / 10.0)::numeric(8,1) AS "dcVoltage",
          ps.run_time AS "runTime",
          ps.on_time AS "onTime",
          ps.total_kwh AS "totalKWH",
          ps.starts
        FROM pump_summary ps
        WHERE ${predicates.join(" AND ")}
        ORDER BY ps.local_utc_timestamp DESC
        LIMIT $${params.length}
    `;
      }

      const result = await db.tsdbQuery(query, params);
      const out = result.rows.map((row) => ({ ...row, bucketMinutes }));
      return {
        body: JSON.stringify(out),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
