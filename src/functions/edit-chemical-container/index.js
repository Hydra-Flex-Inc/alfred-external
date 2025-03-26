const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const ErrorHandler = require("../../../errorHandler");
const Auth = require("../../../auth");

const executeFunctionLogic = async (body, context) => {
  try {
    const update_query = `
  UPDATE chemical_containers
  SET
    iot_hub_device_id = $1,
    chemical = $2,
    container_size_gals = $3,
    container_type = $4,
    name = $5,
    associated_valves = $6,
    container_cost = $7,
    currency_code = $8,
    id=$9
  WHERE id = $10
  RETURNING id;
`;
    const update_values = [
      body.gatewayId,
      body.chemicalName,
      body.container === "Bullseye" ? null : body.container,
      body.container === "Bullseye" ? "bullseye" : null,
      body.customName,
      JSON.stringify(body.valves),
      body.container_cost,
      body.currency_code,
      body.containerId,
      body.containerId,
    ];
    context.log(update_values);

    const update = await db.query(update_query, update_values);

    console.log("Udated rows (expecting 1): ", update.rowCount);

    return {
      headers: {
        "Content-Type": "application/json",
      },
    };
  } catch (error) {
    return ErrorHandler.prepareResponse(context, error);
  }
};

app.http("edit-chemical-container", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      const body = await req.json();

      const validator = new Validator(body, {
        containerId: "required|uuid",
        chemicalName: "required|string",
        customName: "required|string",
        container: "required|in:15,30,Bullseye",
        valves: "array",
        "valves.*.panel": "integer",
        "valves.*.valve": "integer",
        gatewayId: "required|alpha_dash",
        container_cost: "numeric",
        currency_code: "required|alpha_num",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Ensure that the authorized user is allowed to see this particular device ID.
      await Auth.canAccessDevice(body.gatewayId, authorizedUser, db);

      await executeFunctionLogic(body, context);

      return {
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});

app.http("edit-chemical-container-data", {
  methods: ["POST"],
  authLevel: "function",
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      const body = await req.json();

      const validator = new Validator(body, {
        containerId: "required|uuid",
        chemicalName: "required|string",
        customName: "required|string",
        container: "required|in:15,30,Bullseye",
        valves: "array",
        "valves.*.panel": "integer",
        "valves.*.valve": "integer",
        gatewayId: "required|alpha_dash",
        container_cost: "numeric",
        currency_code: "required|alpha_num",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      await executeFunctionLogic(body, context);

      return {
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
