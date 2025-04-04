const { app } = require("@azure/functions");
const db = require("../../../db");
const Validator = require("../../../validator");
const ErrorHandler = require("../../../errorHandler");
const Auth = require("../../../auth");
const Common = require("../../../common");

// Uses user_id and business_id

app.http("maintenance-events", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db);

      const validator = new Validator(req.req_query, {
        lid: "uuid",
        count: "integer",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // prepare params.
      const params = [authorizedUser.user_id, authorizedUser.business_id];
      const predicates = [
        "users.id = $1",
        "locations.business_id = $2",
        "users.deleted_at IS NULL",
        "businesses.deleted_at IS NULL",
        "locations.deleted_at IS NULL",
        "gateways.deleted_at IS NULL",
        "maintenance_events.deleted_at IS NULL",
        "maintenance_events.completed_at IS NULL",
      ];

      // Optionally, filter by a single location.
      if (req.req_query.lid) {
        params.push(req.req_query.lid);
        predicates.push(`locations.id = $${params.length}`);
      }

      // This query can return a massive amount of rows. Set a reasonable limit as a default.
      if (req.req_query.count) {
        params.push(parseInt(req.req_query.count, 10));
      } else {
        params.push(30000);
      }

      const query = `
    SELECT maintenance_events.*,
           COALESCE(maintenance_events.event_type, 'valve_maintenance') AS event_type,
           locations.id AS location_id,
           components.id AS component_id,
           components.name AS component_name,
           components.type AS component_type
    FROM users
      LEFT JOIN users_to_businesses ON users.id = users_to_businesses.user_id
      LEFT JOIN businesses ON users_to_businesses.business_id = businesses.id
      LEFT JOIN locations ON businesses.id = locations.business_id
      LEFT JOIN gateways ON locations.id = gateways.location_id
      JOIN maintenance_events ON gateways.iot_hub_device_id = maintenance_events.iot_hub_device_id
      LEFT JOIN components
        ON maintenance_events.iot_hub_device_id = components.iot_hub_device_id
          AND maintenance_events.modbus_id = components.modbus_id
    WHERE ${predicates.join(" AND ")}
    ORDER BY maintenance_events.created_at DESC
    LIMIT $${params.length}
      `;
      const result = await db.query(query, params);

      const out = [];

      for (const row of result.rows) {
        out.push(row);
      }
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

// get maintenance events using gateway_id
app.http("maintenance-events-data", {
  methods: ["GET"],
  authLevel: "function",
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      const validator = new Validator(req.req_query, {
        gateway_id: "required|alpha_dash",
        // lid: "uuid",
        count: "integer",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // prepare params.
      const params = [req.req_query.gateway_id];
      const predicates = [
        "gateways.iot_hub_device_id = $1",
        "gateways.deleted_at IS NULL",
        "maintenance_events.deleted_at IS NULL",
        "maintenance_events.completed_at IS NULL",
      ];

      // This query can return a massive amount of rows. Set a reasonable limit as a default.
      if (req.req_query.count) {
        params.push(parseInt(req.req_query.count, 10));
      } else {
        params.push(30000);
      }

      const query = `
    SELECT maintenance_events.*,
           COALESCE(maintenance_events.event_type, 'valve_maintenance') AS event_type,
           components.id AS component_id,
           components.name AS component_name,
           components.type AS component_type
    FROM gateways
      JOIN maintenance_events ON gateways.iot_hub_device_id = maintenance_events.iot_hub_device_id
      LEFT JOIN components
        ON maintenance_events.iot_hub_device_id = components.iot_hub_device_id
          AND maintenance_events.modbus_id = components.modbus_id
    WHERE ${predicates.join(" AND ")}
    ORDER BY maintenance_events.created_at DESC
    LIMIT $${params.length}
      `;
      const result = await db.query(query, params);

      const out = [];

      for (const row of result.rows) {
        out.push(row);
      }
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
