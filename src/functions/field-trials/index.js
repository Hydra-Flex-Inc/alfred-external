const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

const executeFunctionLogic = async (req, context) => {
  try {
    let out;
    const predicates = [];
    const params = [];

    predicates.push(`xref.location_id = $${predicates.length + 1}`);
    params.push(req.req_query.locationId);

    if (req.req_query.fieldTrialId) {
      predicates.push(`ft.id = $${predicates.length + 1}`);
      params.push(req.req_query.fieldTrialId);
      const accessQuery = `SELECT COUNT(*)
    FROM field_trials ft
    LEFT JOIN field_trials_to_locations xref ON ft.id = xref.field_trial_id
    WHERE ${predicates.join(" AND ")}
      AND ft.deleted_at IS NULL
      AND ft.is_active = true
      AND xref.deleted_at IS NULL`;
      const accessFieldTrial = await db.query(accessQuery, params);
      out = accessFieldTrial.rows[0].count === 1;
    } else {
      const fieldTrialsQuery = `SELECT ft.id
      FROM field_trials ft
      LEFT JOIN field_trials_to_locations xref ON ft.id = xref.field_trial_id
      WHERE ${predicates.join(" AND ")}
        AND ft.deleted_at IS NULL
        AND ft.is_active = true
        AND xref.deleted_at IS NULL`;
      const fieldTrials = await db.query(fieldTrialsQuery, params);
      out = { fieldTrialIds: fieldTrials.rows.map((x) => x.id) };
    }

    return out;
  } catch (error) {
    return ErrorHandler.prepareResponse(context, error);
  }
};

app.http("field-trials", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      const validator = new Validator(req.req_query, {
        locationId: "uuid|required",
        fieldTrialId: "uuid",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Ensure that the authorized user is allowed to see this particular location
      await Auth.canAccessLocation(
        req.req_query.locationId,
        authorizedUser,
        db
      );

      const out = await executeFunctionLogic(req, context);

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

app.http("field-trials-data", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      const validator = new Validator(req.req_query, {
        locationId: "uuid|required",
        fieldTrialId: "uuid",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      const out = await executeFunctionLogic(req, context);

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
