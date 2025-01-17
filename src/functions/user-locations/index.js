const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const { ManagementClient } = require("auth0");
const config = require("../../../config");
config.auth0.scope = "read:users";
const management = new ManagementClient(config.auth0);

app.http("user-locations", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized Auth0 user
      const auth0User = await Auth.authorizeUser(req, db);

      // Use the Auth0 user to get the Alfred user and their relationship to the business
      const lookupUserQuery = await db.query(
        `
      SELECT
        u.id AS user_id,
        u.system_alerts_block_list AS system_alerts_block_list,
        u.wants_email,
        u.wants_push,
        b.id AS business_id,
        b.name AS business_name,
        u2b.role_type AS role_type
      FROM
        users u
        LEFT JOIN users_to_businesses u2b
          ON u.id = u2b.user_id
        LEFT JOIN businesses b
          ON u2b.business_id = b.id
      WHERE
        u.id = $1
        AND u.deleted_at IS NULL
        AND b.deleted_at IS NULL
      `,
        [auth0User.user_id]
      );

      if (lookupUserQuery.rowCount === 0) {
        const error = new Error("User not found");
        error.status = 404;
        throw error;
      }
      const alfredUserData = lookupUserQuery.rows[0];

      // Retrieve additional information about the Auth0 user
      const auth0UserData = await management.users.get({
        id: auth0User.auth0_id,
      });

      // begin to fill in the output object
      const out = {
        ...auth0UserData,
        ...alfredUserData,
        locations: [],
      };

      // Gather user's locations based on `role_type`
      switch (alfredUserData.role_type) {
        case "admin": {
          // ADMIN users need all the locations associated with a business
          const lookupAdminLocationsQuery = await db.query(
            `
          SELECT
            l.id,
            l.display_name AS name,
            l.address,
            l.city,
            l.region,
            l.postal_code,
            l.phone,
            l.description,
            l.coordinates,
            l.timezone,
            l.water_cost_per_gallon,
            l.currency_code,
            l.created_at,
            l.hours,
            ARRAY_REMOVE(ARRAY_AGG(ft.id), NULL) field_trials
          FROM
            users u
            LEFT JOIN users_to_businesses u2b
              ON u.id = u2b.user_id
            LEFT JOIN businesses b
              ON u2b.business_id = b.id
            LEFT JOIN locations l
              ON b.id = l.business_id
            LEFT JOIN field_trials_to_locations ftxref
              ON ftxref.location_id = l.id AND ftxref.deleted_at IS NULL
            LEFT JOIN field_trials ft
              ON ft.id = ftxref.field_trial_id AND ft.deleted_at IS NULL AND ft.is_active = true
          WHERE
            u.id = $1
            AND u.deleted_at IS NULL
            AND l.deleted_at IS NULL
            AND b.deleted_at IS NULL
          GROUP BY l.id
          ORDER BY name ASC
          `,
            [auth0User.user_id]
          );
          out.locations = lookupAdminLocationsQuery.rows;
          break;
        }
        case "member": {
          // MEMBER users are explicitly graanted access to particular locations
          const lookupMemberLocationsQuery = await db.query(
            `
          SELECT
            l.id,
            l.display_name AS name,
            l.address,
            l.city,
            l.region,
            l.postal_code,
            l.phone,
            l.description,
            l.coordinates,
            l.timezone,
            l.water_cost_per_gallon,
            l.currency_code,
            l.created_at,
            l.hours,
            ARRAY_REMOVE(ARRAY_AGG(ft.id), NULL) field_trials
          FROM
            users u
            LEFT JOIN users_to_locations u2l
              ON u.id = u2l.user_id
            LEFT JOIN locations l
              ON u2l.location_id = l.id
            LEFT JOIN field_trials_to_locations ftxref
              ON ftxref.location_id = l.id AND ftxref.deleted_at IS NULL
            LEFT JOIN field_trials ft
              ON ft.id = ftxref.field_trial_id AND ft.deleted_at IS NULL AND ft.is_active = true
          WHERE
            u.id = $1
            AND u.deleted_at IS NULL
            AND l.deleted_at IS NULL
          GROUP BY l.id
          ORDER BY name ASC
          `,
            [auth0User.user_id]
          );
          out.locations = lookupMemberLocationsQuery.rows;
          break;
        }
        default: {
          // No action needed
          break;
        }
      }

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
