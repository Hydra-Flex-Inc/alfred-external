const { app } = require("@azure/functions");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const Common = require("../../../common");

const getBackOfficeAssociationCode = async (req, context) => {
  try {
    const body = await req.json();
    const validator = new Validator(body, {
      location_id: "required|uuid",
    });

    if (validator.fails()) {
      throw validator.errors;
    }

    let out;
    const location_id = body.location_id;
    let business_id = null;

    // We want to be sure this is a real location, and while doing so, get this location's business_id
    const locationQuery = `
  SELECT
    *
  FROM locations
  WHERE
    id = $1
    AND deleted_at IS NULL
`;
    const locationResult = await db.query(locationQuery, [location_id]);

    if (locationResult.rowCount !== 1) {
      const error = new Error("Invalid location_id");
      error.status = 400;
      throw error;
    }
    const location = locationResult.rows[0];

    if (location.business_id === null) {
      const error = new Error("Location is not associated with a business.");
      error.status = 400;
      throw error;
    } else {
      business_id = location.business_id;
    }

    // Now look for a valid existing association code
    const searchParams = [location_id, business_id];
    const searchQuery = `
  SELECT
    code AS association_code,
    expires_at,
    location_id,
    business_id 
  FROM back_office_association_codes
  WHERE
    location_id = $1
    AND business_id = $2
    AND expires_at > NOW()
    AND deleted_at IS NULL
  LIMIT 1;
`;
    const searchResult = await db.query(searchQuery, searchParams);

    if (searchResult.rowCount === 1) {
      // If a valid code exists, let's use it
      out = searchResult.rows[0];
    } else {
      // One doesn't exist so let's make one

      const insertParams = [location_id, business_id];
      const insertQuery = `
    INSERT INTO back_office_association_codes
      (location_id, business_id) 
    VALUES
      ($1, $2) 
    RETURNING
      code AS association_code,
      expires_at,
      location_id,
      business_id;
  `;
      const insertResult = await db.query(insertQuery, insertParams);

      if (insertResult.rowCount !== 1) {
        const error = new Error("Failed to create a new association code");
        error.status = 500;
        throw error;
      }

      // no error? use the result
      out = insertResult.rows[0];
    }

    return out;
  } catch (error) {
    return ErrorHandler.prepareResponse(context, error);
  }
};

app.http("back-office-association-code", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      req = await Common.parseRequest(req);
      // Authorize and retrieve the user making the request.
      // We don't need to use this object later, but we need to make sure the user is legit.
      await Auth.authorizeUser(req, db);

      const out = await getBackOfficeAssociationCode(req, context);

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

app.http("back-office-association-code-data", {
  methods: ["POST"],
  authLevel: "function",
  handler: async (req, context) => {
    try {
      req = await Common.parseRequest(req);

      const out = await getBackOfficeAssociationCode(req, context);

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
