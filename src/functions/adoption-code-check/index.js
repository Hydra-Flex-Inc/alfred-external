const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

const getAdoptionCodeData = async (req, context) => {
  try {
    // prepare params
    const params = [req.req_query.adoption_code];
    const predicates = [
      "lac.code = $1",
      "lac.deleted_at IS NULL",
      "l.deleted_at IS NULL",
    ];

    const query = `
SELECT 
  l.id,
  l.business_id,
  l.display_name as name,
  l.address,
  l.city,
  l.region,
  l.postal_code,
  l.phone,
  l.description,
  l.coordinates,
  g.iot_hub_device_id as gateway_id,
  lac.used_on_date as code_used_on_date,
  lac.valid_thru as code_valid_thru
FROM
  locations l
  LEFT JOIN location_adoption_codes lac
    ON l.id = lac.location_id
  LEFT JOIN gateways g
    ON l.id = g.location_id
WHERE ${predicates.join(" AND ")}
`;
    const result = await db.query(query, params);

    if (!result.rowCount) {
      const error = new Error(
        "Sorry, this doesn't seem to be a valid adoption code."
      );

      error.status = 400;
      throw error;
    }

    const location = result.rows.pop();

    if (location.code_used_on_date) {
      const error = new Error(
        "Sorry, this adoption code has already been used."
      );
      error.status = 400;
      throw error;
    } else if (
      location.code_valid_thru &&
      location.code_valid_thru * 1000 < Date.now()
    ) {
      const error = new Error("Sorry, this adoption code has expired.");
      error.status = 400;
      throw error;
    } else if (location.business_id) {
      const error = new Error("Sorry, this location has already been adopted.");
      error.status = 400;
      throw error;
    }

    // Combine the results of the 2 queries.
    const out = {
      adoption_code: req.req_query.adoption_code,
      location: location,
    };

    return out;
  } catch (error) {
    return ErrorHandler.prepareResponse(context, error);
  }
};

app.http("adoption-code-check", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Make sure there is an authorized user.
      await Auth.authorizeUser(req, db, {
        requireAdminRole: true,
      });

      // Validate input.
      const validator = new Validator(req.req_query, {
        adoption_code: "required|alpha_num",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      const out = await getAdoptionCodeData(req, context);
      return {
        status: 200,
        body: JSON.stringify(out),
        headers: { "Content-Type": "application/json" },
      };
    } catch {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});

app.http("adoption-code-check-data", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      // Validate input.
      const validator = new Validator(req.req_query, {
        adoption_code: "required|alpha_num",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      const out = await getAdoptionCodeData(req, context);
      return {
        status: 200,
        body: JSON.stringify(out),
        headers: { "Content-Type": "application/json" },
      };
    } catch {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
