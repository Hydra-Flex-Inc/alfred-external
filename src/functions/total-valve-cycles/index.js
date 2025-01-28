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
    const predicates = [`vns.device_id = $1`];

    const query = `
    SELECT vns.modbus_id AS "modbusId",
      SUM(vns.cycles_v1) AS v1,
      SUM(vns.cycles_v2) AS v2,
      SUM(vns.cycles_v3) AS v3,
      SUM(vns.cycles_v4) AS v4,
      SUM(vns.cycles_v5) AS v5,
      SUM(vns.cycles_v6) AS v6,
      SUM(vns.cycles_v7) AS v7
    FROM valvenode_summary vns
    WHERE ${predicates.join(" AND ")}
    GROUP BY vns.modbus_id
    ORDER BY vns.modbus_id
  `;
    const result = await db.tsdbQuery(query, params);

    // Retrieve all maintenance events completed but not deleted
    const cycleFilter = await db.query(
      `
    SELECT
      iot_hub_device_id,
      modbus_id,
      metadata->'valve' AS valve,
      metadata
    FROM maintenance_events
    WHERE iot_hub_device_id = $1
      AND deleted_at IS NULL
      AND completed_at IS NOT NULL
  `,
      params
    );

    result.rows.forEach((item) => {
      for (let i = 1, len = 7; i <= len; ++i) {
        const completedCycles = cycleFilter.rows.reduce((sum, cur) => {
          // If signatures match
          if (cur.modbus_id === item.modbusId && +cur.valve === i) {
            return sum + cur.metadata.completedCycles;
          }
          return sum;
        }, 0);
        item[`v${i}`] = item[`v${i}`] - completedCycles;
      }
    });

    const out = [];

    for (const row of result.rows) {
      out.push(row);
    }

    return out;
  } catch (error) {
    return ErrorHandler.prepareResponse(context, error);
  }
};

app.http("total-valve-cycles", {
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

app.http("total-valve-cycles-data", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      // Validate input.
      const validator = new Validator(req.query, {
        deviceId: "required|alpha_dash",
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
