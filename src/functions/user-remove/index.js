const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

app.http("user-remove", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db);

      const body = await req.json();

      // Validate input
      const validator = new Validator(body, {
        user_id: "required|uuid",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Do not allow the authorized user to remove themself.
      if (authorizedUser.user_id === body.user_id) {
        const error = new Error("The logged in user cannot remove themself.");
        error.status = 400;
        throw error;
      }

      // Ensure that the authorized user is allowed to change this user.
      await Auth.canAccessUser(body.user_id, authorizedUser, db);

      // Remove user from business.
      const params = [body.user_id, authorizedUser.business_id];
      const predicates = ["user_id = $1", "business_id = $2"];

      const query = `
      DELETE FROM users_to_businesses
      WHERE ${predicates.join(" AND ")}
      RETURNING user_id, business_id
    `;

      const result = await db.query(query, params);

      const deletedUser = result.rows.length > 0 ? result.rows.shift() : {};

      const out = {
        ...deletedUser,
        message: "Successfully removed user.",
      };

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
