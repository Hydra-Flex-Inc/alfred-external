const { app } = require("@azure/functions");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const ParseRequest = require("../../../parseRequest");

app.http("chemical-containers", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = ParseRequest.parse(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      const validator = new Validator(req.query, {
        gatewayId: "required|alpha_dash",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Ensure that the authorized user is allowed to see this particular device ID.
      await Auth.canAccessDevice(req.query.gatewayId, authorizedUser, db);

      const query = `
      SELECT
        cc.id,
        cc.iot_hub_device_id,
        cc.chemical,
        cc.container_size_gals,
        cc.container_type,
        cc.name,
        cc.sensors,
        cc.container_cost,
        cc.currency_code,
        cc.associated_valves,
        array_agg(ls.id) AS level_sensor_ids,
        array_agg(ls.mac_address) AS level_sensor_mac_addresses,
        array_agg(cwp.id) AS car_wash_package_ids
      FROM level_sensors ls
        INNER JOIN chemical_containers_to_level_sensors cc2ls
          ON ls.id = cc2ls.level_sensor_id     
        INNER JOIN chemical_containers cc
          ON cc.id = cc2ls.chemical_container_id
        INNER JOIN car_wash_packages_to_chemical_containers cwp2cc
          ON cc.id = cwp2cc.chemical_container_id
        INNER JOIN car_wash_packages cwp
          ON cwp.id = cwp2cc.car_wash_package_id
      WHERE
        ls.iot_hub_device_id = $1
        AND cc.deleted_at IS NULL
        AND cc2ls.deleted_at IS NULL
        AND ls.deleted_at IS NULL
      GROUP BY
        cc.id
      ORDER BY
        cc.name ASC
      `;

      const chemical_containers = await db.query(query, [req.query.gatewayId]);
      const out = chemical_containers.rows;

      // I think the sql isn't quite right. We get duplicates of some joined items
      // so we need to remove duplicates.
      out.forEach((d) => {
        d.level_sensor_ids = [...new Set(d.level_sensor_ids)];
        d.level_sensor_mac_addresses = [
          ...new Set(d.level_sensor_mac_addresses),
        ];
        d.car_wash_package_ids = [...new Set(d.car_wash_package_ids)];
      });

      return { body: JSON.stringify(out) };
    } catch (error) {
      // Handle errors
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
