const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

app.http("adopt-location", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireAdminRole: true,
      });

      const body = await req.json();

      // Validate input
      const validator = new Validator(body, {
        business_name: "freeflow",
        location_name: "required|freeflow",
        adoption_code: "required|alpha_num",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      if (!authorizedUser.business_id) {
        if (!body.business_name) {
          const error = new Error(
            "Business name required for users without a business."
          );
          error.status = 400;
          throw error;
        }
      }

      const client = await db.getClient();

      // Retrieve information regarding this adoption code, and validate that this is a valid usage of this adoption code.

      // prepare params
      const params = [body.adoption_code];
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
        l.description,
        l.coordinates,
        lac.used_on_date as code_used_on_date,
        lac.valid_thru as code_valid_thru
      FROM
        locations l
        LEFT JOIN location_adoption_codes lac
          ON l.id = lac.location_id
      WHERE ${predicates.join(" AND ")}
      `;
      let result = await db.query(query, params);

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
        const error = new Error(
          "Sorry, this location has already been adopted."
        );
        error.status = 400;
        throw error;
      }

      // Start a transaction, since we'll be updating several tables across multiple queries.
      await client.query("BEGIN");

      // Add business to database if no Business ID was sent. (optional)
      let business = {
        id: authorizedUser.business_id,
        name: body.business_name,
      };
      if (!authorizedUser.business_id) {
        result = await client.query(
          `
        INSERT INTO businesses(
          name
        )
        VALUES ( $1 )
        RETURNING id, name
      `,
          [body.business_name]
        );

        // Retrieve new business returned by RETURNING *.
        business = result.rows.pop();

        // Associate new business with passed in User ID.
        await client.query(
          `
        INSERT INTO users_to_businesses(
          user_id,
          business_id,
          role_type
        )
        VALUES(
          $1,
          $2,
          'admin'
        )
      `,
          [authorizedUser.user_id, business.id]
        );
      }

      // Link the business to the location, and set the location name
      /*
      TODO it would be nice to update the other location fields here, without duplicating
      code from \location. This would allow us to keep the update query in the same DB transaction. EAPI-28
     */
      await client.query(
        `
     UPDATE locations
     SET business_id = $1,
     display_name = $2
     WHERE id = $3
   `,
        [business.id, body.location_name, location.id]
      );

      // Mark the adoption code as used.
      const now = Math.floor(Date.now() / 1000); // Convert current time from ms to seconds.
      await client.query(
        `
      UPDATE location_adoption_codes
      SET used_on_date = $1
      WHERE code = $2
      AND location_id = $3
    `,
        [now, body.adoption_code, location.id]
      );

      // If all queries were successful, commit.
      await client.query("COMMIT");

      // We can also release the client
      client.release();

      return {
        body: JSON.stringify({
          adoption_code: body.adoption_code,
          location: {
            ...location,
            name: body.location_name,
          },
          business: business,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
