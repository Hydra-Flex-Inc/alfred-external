const { app } = require("@azure/functions");
const db = require("../../../db");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const Validator = require("../../../validator");
const Common = require("../../../common");

app.http("location-name", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      const validator = new Validator(req.query, {
        gatewayId: "required|string",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      let carWashName = "Chem-Sense Dashboard";

      const query = `
    SELECT
      l.id,
      l.display_name,
      l.city,
      l.region
    FROM
      locations l
      LEFT JOIN gateways g
        ON l.id = g.location_id
    WHERE
      g.iot_hub_device_id = '${req.query.gatewayId}'
  `;
      const result = await db.query(query);
      const location = result?.rows[0] || {};
      if (location.display_name) {
        carWashName = location.display_name;
        if (location.city && location.region) {
          carWashName += ` @ ${location.city}, ${location.region}`;
        }
      } else {
        carWashName += ` (${req.query.gatewayId})`;
      }
      return { body: JSON.stringify(carWashName) };
    } catch (error) {
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
