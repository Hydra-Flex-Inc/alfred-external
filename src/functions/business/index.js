const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

app.http("business", {
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

      // Validate input
      const validator = new Validator(body, {
        id: "required|uuid",
        name: "freeflow",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Ensure that the authorized user is allowed to change this business.
      await Auth.canAccessBusiness(body.id, authorizedUser);

      // prepare params
      const params = [];
      const updates = [];

      // List of fields that are allowed to be changed by this API call.
      const mutableFields = ["name"];

      mutableFields.forEach((field) => {
        if (body[field] !== undefined) {
          params.push(body[field]);
          updates.push(`${field} = $${params.length}`);
        }
      });

      // Only proceed if we found a field to update in the request body.
      if (updates.length) {
        params.push(body.id); // Add the ID for the where condition.

        // Save the updates to the component.
        const query = `
        UPDATE businesses
          SET ${updates.join(", ")}
          WHERE businesses.id = $${params.length}
      `;

        await db.query(query, params);
      }

      // echo the passed in request if saved successfully.
      return {
        body: JSON.stringify(body),
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
