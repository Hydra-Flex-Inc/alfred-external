const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

app.http("component", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
        requireAdminRole: true,
      });

      const body = await req.json();

      // Validate input.
      const validator = new Validator(body, {
        id: "required|uuid",
        name: "required|freeflow",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Ensure that the authorized user is allowed to update this particular component
      const deviceId = await Auth.canAccessComponent(
        body.id,
        authorizedUser,
        db
      );

      // Double check that this name was not already taken.
      let query = `
      SELECT id
      FROM components
      WHERE name = $1 
        AND id != $2 
        AND iot_hub_device_id = $3
        AND deleted_at IS NULL
    `;
      const result = await db.query(query, [body.name, body.id, deviceId]);

      if (result.rowCount > 0) {
        const error = new Error("Each component must have a unique name.");
        error.status = 400;
        throw error;
      }

      // prepare params
      const params = [body.name, body.id, deviceId];
      const updates = ["name = $1"];
      const predicates = ["components.id = $2", "iot_hub_device_id = $3"];

      // Save the updates to the component.
      query = `
      UPDATE components
        SET ${updates.join(", ")}
        WHERE ${predicates.join(" AND ")}
    `;

      await db.query(query, params);

      // echo the passed in request if saved successfully.
      return {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
