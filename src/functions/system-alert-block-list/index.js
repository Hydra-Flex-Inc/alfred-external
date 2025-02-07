const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

// Uses user_id

app.http("system-alert-block-list", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db);

      const body = await req.json();

      // Validate input.
      // TODO validate to make sure every item in the system alerts block list is one of our defined alert types.
      const validator = new Validator(body, {
        system_alerts_block_list: "present|array",
        "system_alerts_block_list.*": "freeflow",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // prepare params
      const params = [
        JSON.stringify(body.system_alerts_block_list), // $1
        authorizedUser.user_id, // $2
      ];

      // Save the block list.
      const query = `
      UPDATE users
        SET system_alerts_block_list = $1
        WHERE users.id = $2
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
