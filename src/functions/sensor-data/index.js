const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const ErrorHandler = require("../../../errorHandler");

// No auth on this so no need to reconfigure

app.http("sensor-data", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      const validator = new Validator(req.req_query, {
        gatewayId: "required|alpha_dash",
        start: "iso8601",
        end: "iso8601",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      const tdsbQuery = `
    SELECT
        gateway_id,
        device_id,
        (unnest(lttb(time, dist_mm, 180))).*
    FROM
        level_sense_state
    WHERE
        gateway_id = $1
        AND dist_mm IS NOT NULL
        AND dist_mm >= 40
        AND dist_mm <= 785
        AND time >= $2
        AND time <= $3
    GROUP BY
        gateway_id,
        device_id
    `;

      // Query all sensors connected to the gateway
      const query_values = [
        req.req_query.gatewayId,
        req.req_query.start,
        req.req_query.end,
      ];

      const sensors = await db.tsdbQuery(tdsbQuery, query_values);
      if (!sensors.rowCount) {
        const error = new Error(
          "No valid sensors found for the given gateway."
        );
        error.status = 400;
        throw error;
      }
      const sortedSensors = [];

      // Sort the sensors by device_id
      sensors.rows.forEach((sensor) => {
        const sensorIndex = sortedSensors.findIndex(
          (s) => s.device_id === sensor.device_id
        );

        if (sensorIndex === -1) {
          sortedSensors.push({
            gateway_id: sensor.gateway_id,
            device_id: sensor.device_id,
            sensor_data: [
              {
                time: sensor.time,
                value: sensor.value,
              },
            ],
          });
        } else {
          sortedSensors[sensorIndex].sensor_data.push({
            time: sensor.time,
            value: sensor.value,
          });
        }
      });

      // Query Alfred for chemical container information
      for (const s of sortedSensors) {
        const alfredQuery = `
          SELECT
            name,
            container_size_gals
          FROM chemical_containers cc
            JOIN chemical_containers_to_level_sensors cc2ls
              ON cc2ls.chemical_container_id = cc.id
            JOIN level_sensors ls
              ON cc2ls.level_sensor_id = ls.id
          WHERE
            ls.mac_address = $1
            AND cc.deleted_at IS NULL -- soft-deleted containers are invalid
          ORDER by cc.iot_hub_device_id
        `;

        const alfredQueryRes = await db.query(alfredQuery, [s.device_id]);
        if (alfredQueryRes.rowCount) {
          s.name = alfredQueryRes.rows[0].name;
          s.container_size_gals =
            alfredQueryRes.rows[0].container_size_gals ?? "bullseye";
        } else {
          s.name = "";
          s.container_size_gals = "";
        }
      }

      return {
        body: JSON.stringify(sortedSensors),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
