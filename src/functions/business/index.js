const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

const executeFunctionLogic = async (body, context) => {
  console.log("executeFunctionLogic");

  try {
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

    return body;
  } catch (error) {
    return ErrorHandler.prepareResponse(context, error);
  }
};

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

      await executeFunctionLogic(body, context);

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

app.http("business-data", {
  methods: ["POST"],
  authLevel: "function",
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      const body = await req.json();

      // Validate input
      const validator = new Validator(body, {
        id: "required|uuid",
        name: "freeflow",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      await executeFunctionLogic(body, context);

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
