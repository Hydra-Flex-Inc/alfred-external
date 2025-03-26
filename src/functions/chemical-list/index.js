const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const ErrorHandler = require("../../../errorHandler");
const Auth = require("../../../auth");

const executeFunctionLogic = async (req, context) => {
  try {
    const query = await db.query(`
    SELECT name, vendor
    FROM chemicals
    ORDER BY name ASC
    `);

    const chemicals = query.rows; // Assuming there's only one row per user
    return chemicals;
  } catch (error) {
    return ErrorHandler.prepareResponse(context, error);
  }
};

app.http("chemical-list", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      const chemicals = await executeFunctionLogic(req, context);
      return {
        body: JSON.stringify(chemicals),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});

app.http("chemical-list-data", {
  methods: ["GET"],
  authLevel: "function",
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      const chemicals = await executeFunctionLogic(req, context);
      return {
        body: JSON.stringify(chemicals),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
