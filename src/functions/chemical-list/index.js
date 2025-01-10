const { app } = require("@azure/functions");
const db = require("../../../db");
const ErrorHandler = require("../../../errorHandler");
const Auth = require("../../../auth");
const ParseRequest = require("../../../parseRequest");

app.http("chemical-list", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = ParseRequest.parse(req);
      // Retrieve the authorized user.
      // eslint-disable-next-line no-unused-vars
      console.log("req", req.headers);
      await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      const query = await db.query(`
      SELECT name, vendor
      FROM chemicals
      ORDER BY name ASC
      `);

      const chemicals = query.rows; // Assuming there's only one row per user
      return { body: JSON.stringify(chemicals) };
    } catch (error) {
      // Handle errors

      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
