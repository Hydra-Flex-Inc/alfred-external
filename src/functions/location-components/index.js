const { app } = require("@azure/functions");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const Common = require("../../../common");

// Requires business id
app.http("location-components", {
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
        lid: "required|uuid",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      context.log("authorizedUser.business_id", authorizedUser.business_id);
      // prepare params
      const params = [req.req_query.lid, authorizedUser.business_id];
      const predicates = [
        "l.id = $1",
        "l.business_id = $2",
        "l.deleted_at IS NULL",
        "g.deleted_at IS NULL",
        "c.deleted_at IS NULL",
      ];

      const query = `
      SELECT
        g.iot_hub_device_id AS iot_hub_device_id,
        c.id AS component_id,
        c.modbus_id AS component_modbus_id,
        c.position AS component_position,
        c.type AS component_type,
        c.name AS component_name
      FROM
        locations l
        LEFT JOIN gateways g
          ON l.id = g.location_id
        LEFT JOIN components c
          ON g.iot_hub_device_id = c.iot_hub_device_id
      WHERE ${predicates.join(" AND ")}
      ORDER BY
        iot_hub_device_id,
        c.position ASC
    `;

      const result = await db.query(query, params);
      if (result.rowCount === 0) {
        const error = new Error("No components found.");
        error.status = 404;
        throw error;
      }

      const out = {
        components: [],
      };

      result.rows.forEach((row, index) => {
        if (index === 0) {
          out.iot_hub_device_id = row.iot_hub_device_id;
        }
        out.components.push({
          id: row.component_id,
          modbus_id: row.component_modbus_id,
          position: row.component_position,
          type: row.component_type,
          name: row.component_name,
        });
      });

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

// Uses gateway id to retrieve components
app.http("location-components-data", {
  methods: ["GET"],
  authLevel: "function",
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      // Validate input.
      const validator = new Validator(req.req_query, {
        gateway_id: "required|alpha_dash",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // prepare params
      const params = [req.req_query.gateway_id];
      const predicates = [
        "g.iot_hub_device_id = $1",
        "g.deleted_at IS NULL",
        "c.deleted_at IS NULL",
      ];

      const query = `
      SELECT
        g.iot_hub_device_id AS iot_hub_device_id,
        c.id AS component_id,
        c.modbus_id AS component_modbus_id,
        c.position AS component_position,
        c.type AS component_type,
        c.name AS component_name
      FROM
        gateways g
        LEFT JOIN components c
          ON g.iot_hub_device_id = c.iot_hub_device_id
      WHERE ${predicates.join(" AND ")}
      ORDER BY
        iot_hub_device_id,
        c.position ASC
    `;

      const result = await db.query(query, params);
      if (result.rowCount === 0) {
        const error = new Error("No components found.");
        error.status = 404;
        throw error;
      }

      const out = {
        components: [],
      };

      result.rows.forEach((row, index) => {
        if (index === 0) {
          out.iot_hub_device_id = row.iot_hub_device_id;
        }
        out.components.push({
          id: row.component_id,
          modbus_id: row.component_modbus_id,
          position: row.component_position,
          type: row.component_type,
          name: row.component_name,
        });
      });

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
