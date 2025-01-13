const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

app.http("user-update-notification", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db);

      // Validate input
      const validator = new Validator(req.body, {
        wants_email: "required|boolean",
        wants_push: "required|boolean",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Prepare params
      const params = [
        req.body.wants_email, // $1
        req.body.wants_push, // $2
        authorizedUser.auth0_id, // $3
      ];

      // Prepare the update query
      const query = `
      UPDATE users
      SET
        wants_email = $1,
        wants_push = $2
      WHERE auth0_id = $3
    `;

      // Execute the update query
      const queryResults = await db.query(query, params);

      // this should have affected exactly one row
      if (queryResults.rowCount !== 1) {
        const error = new Error("UPDATE query unsuccessful");
        error.code = "HTTP_500";
        throw error;
      }

      // Return the success response
      return {
        body: JSON.stringify(queryResults.rows),
        headers: { "Content-Type": "application/json" },
      };
    } catch (error) {
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
