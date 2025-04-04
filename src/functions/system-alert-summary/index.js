const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

// Uses user_id and business_id

app.http("system-alert-summary", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db);

      // Validate input.
      const validator = new Validator(req.req_query, {
        lid: "uuid",
        since: "integer",
        count: "integer",
        offset: "integer",
        totalCount: "boolean",
        locationCount: "boolean",
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
        "system_alerts.deleted_at IS NULL",
      ];

      // Setup the return object
      const out = {
        alerts: [],
      };

      // If totalCount specified, grab the total count of alerts without later filtering
      if (req.req_query.totalCount) {
        const countQuery = `
        SELECT count(*) AS alert_count
        FROM users
        LEFT JOIN users_to_businesses ON users.id = users_to_businesses.user_id
        LEFT JOIN businesses ON users_to_businesses.business_id = businesses.id
        LEFT JOIN locations ON businesses.id = locations.business_id
        LEFT JOIN gateways ON locations.id = gateways.location_id
        JOIN system_alerts ON gateways.iot_hub_device_id = system_alerts.iot_hub_device_id
        LEFT JOIN components 
          ON system_alerts.iot_hub_device_id = components.iot_hub_device_id 
            AND system_alerts.modbus_id = components.modbus_id
        WHERE ${predicates.join(" AND ")}
      `;
        const countResult = await db.query(countQuery, params);
        out.totalCount = countResult.rows[0].alert_count;
      }

      // Optionally, filter by a single location.
      if (req.req_query.lid) {
        params.push(req.req_query.lid);
        predicates.push(`locations.id = $${params.length}`);
      }

      // If locationCount specified, grab the filtered count including the location filter
      // Requires that a location id is provided
      if (req.req_query.lid && req.req_query.locationCount) {
        const countQuery = `
        SELECT count(*) AS alert_count
        FROM users
        LEFT JOIN users_to_businesses ON users.id = users_to_businesses.user_id
        LEFT JOIN businesses ON users_to_businesses.business_id = businesses.id
        LEFT JOIN locations ON businesses.id = locations.business_id
        LEFT JOIN gateways ON locations.id = gateways.location_id
        JOIN system_alerts ON gateways.iot_hub_device_id = system_alerts.iot_hub_device_id
        LEFT JOIN components 
          ON system_alerts.iot_hub_device_id = components.iot_hub_device_id 
            AND system_alerts.modbus_id = components.modbus_id
        WHERE ${predicates.join(" AND ")}
      `;
        const countResult = await db.query(countQuery, params);
        out.locationCount = countResult.rows[0].alert_count;
      }

      // Limit to alerts since a certain time.
      if (req.req_query.since) {
        params.push(parseInt(req.req_query.since, 10));
        predicates.push(`unixtime > $${params.length}`);
      }

      // This query can return a massive amount of rows. Set a reasonable limit as a default.
      if (req.req_query.count) {
        params.push(parseInt(req.req_query.count, 10));
      } else {
        params.push(30000);
      }

      // Add the offset to do paginated queries
      if (req.req_query.offset) {
        params.push(parseInt(req.req_query.offset, 10));
      } else {
        params.push(0);
      }

      const query = `
      SELECT system_alerts.*,
             locations.id AS location_id,
             components.id AS component_id,
             components.name AS component_name,
             components.type AS component_type
      FROM users
        LEFT JOIN users_to_businesses ON users.id = users_to_businesses.user_id
        LEFT JOIN businesses ON users_to_businesses.business_id = businesses.id
        LEFT JOIN locations ON businesses.id = locations.business_id
        LEFT JOIN gateways ON locations.id = gateways.location_id
        JOIN system_alerts ON gateways.iot_hub_device_id = system_alerts.iot_hub_device_id
        LEFT JOIN components 
          ON system_alerts.iot_hub_device_id = components.iot_hub_device_id 
            AND system_alerts.modbus_id = components.modbus_id
      WHERE ${predicates.join(" AND ")}
      ORDER BY system_alerts.unixtime DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `;

      const result = await db.query(query, params);

      for (const row of result.rows) {
        out.alerts.push(row);
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

/*
In order to use this without the user id I refactored this to take an array of gateway ids
The expectation is that the Quivio team will have already figured out what gateways the user can have access to.

With this type of refactor locationCount and totalCount will always be the same.
For now I will keep those fields and just assign them the same value.
*/

app.http("system-alert-summary-data", {
  methods: ["GET"],
  authLevel: "function",
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      req.req_query.gateway_ids = req.req_query.gateway_ids.split(",");

      // Validate input.
      const validator = new Validator(req.req_query, {
        gateway_ids: "required|array",
        "gateway_ids.*": "alpha_dash",
        since: "integer",
        count: "integer",
        offset: "integer",
        totalCount: "boolean",
        locationCount: "boolean",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // prepare params.
      const params = [req.req_query.gateway_ids];
      const predicates = [
        "gateways.iot_hub_device_id = ANY($1)",
        "gateways.deleted_at IS NULL",
        "system_alerts.deleted_at IS NULL",
      ];

      // Setup the return object
      const out = {
        alerts: [],
      };

      // If totalCount or locationCount is specified, grab the total count of alerts
      if (req.req_query.totalCount || req.req_query.locationCount) {
        const countQuery = `
        SELECT count(*) AS alert_count
        FROM gateways
        JOIN system_alerts ON gateways.iot_hub_device_id = system_alerts.iot_hub_device_id
        LEFT JOIN components 
          ON system_alerts.iot_hub_device_id = components.iot_hub_device_id 
            AND system_alerts.modbus_id = components.modbus_id
        WHERE ${predicates.join(" AND ")}
      `;
        const countResult = await db.query(countQuery, params);
        if (req.req_query.locationCount) {
          out.totalCount = countResult.rows[0].alert_count;
        }
        if (req.req_query.locationCount) {
          out.locationCount = countResult.rows[0].alert_count;
        }
      }

      // Limit to alerts since a certain time.
      if (req.req_query.since) {
        params.push(parseInt(req.req_query.since, 10));
        predicates.push(`unixtime > $${params.length}`);
      }

      // This query can return a massive amount of rows. Set a reasonable limit as a default.
      if (req.req_query.count) {
        params.push(parseInt(req.req_query.count, 10));
      } else {
        params.push(30000);
      }

      // Add the offset to do paginated queries
      if (req.req_query.offset) {
        params.push(parseInt(req.req_query.offset, 10));
      } else {
        params.push(0);
      }

      const query = `
      SELECT system_alerts.*,
             components.id AS component_id,
             components.name AS component_name,
             components.type AS component_type
      FROM gateways
        JOIN system_alerts ON gateways.iot_hub_device_id = system_alerts.iot_hub_device_id
        LEFT JOIN components 
          ON system_alerts.iot_hub_device_id = components.iot_hub_device_id 
            AND system_alerts.modbus_id = components.modbus_id
      WHERE ${predicates.join(" AND ")}
      ORDER BY system_alerts.unixtime DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `;

      const result = await db.query(query, params);

      for (const row of result.rows) {
        out.alerts.push(row);
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
