const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const { ManagementClient } = require("auth0");
const config = require("../../../config");
config.auth0.scope = "update:users";
const management = new ManagementClient(config.auth0);

// Uses id, user_id, and business_id

app.http("user", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db);

      const body = await req.json();

      // Validate input
      const validator = new Validator(body, {
        user_id: "required|uuid",
        role_type: "in:admin,member",
        name: "freeflow",
        phone: "phone",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Do not allow the authorized user to remove their own admin privileges
      if (
        authorizedUser.user_id === body.user_id && // updating self
        authorizedUser.role_type === "admin" && // self is an admin
        body.role_type &&
        body.role_type !== "admin" // Attempting update to a non-admin role.
      ) {
        const error = new Error(
          "You can’t remove the admin role from yourself."
        );
        error.status = 400;
        throw error;
      }

      // Ensure that the authorized user is allowed to change this user.
      // TODO: `canAccessUser` is poorly named. It returns the whole user, not a bool.
      // Also seems a bit odd to pass in the `db` object.
      // It's probably bettter to actually get a bool and then keep the getUser obvious in the functions.
      let user = await Auth.canAccessUser(body.user_id, authorizedUser, db);
      console.log(JSON.stringify(user, null, 2));

      // Eliminate all potentially pre-existing users_to_locations for this user,
      // so that we don't unintentionally grant unexpected access
      await db.query(`DELETE FROM users_to_locations WHERE user_id = $1`, [
        user.id,
      ]);

      // Update user's role_type if exists
      if (body.role_type) {
        await db.query(
          `UPDATE users_to_businesses
        SET role_type = $1
        WHERE
          user_id = $2
          AND business_id = $3
        RETURNING
          user_id,
          business_id,
          role_type`,
          [body.role_type, body.user_id, authorizedUser.business_id]
        );
      }

      // NOW get a normal user in the normal way
      const selectUserQuery = await db.query(
        `SELECT
        u.id as user_id,
        u.auth0_id,
        u.system_alerts_block_list,
        u.wants_email,
        u.wants_push,
        u2b.role_type,
        b.id as business_id
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
        [user.id]
      );

      const updatedUser =
        selectUserQuery.rows.length > 0 ? selectUserQuery.rows.shift() : {};

      // Assimilate new data into `user`
      user = {
        ...user,
        ...updatedUser,
        locs: [],
      };

      // Add locations if this user is a "member" role_type and there are locations to add
      if (user.role_type === "member" && body?.locs?.length > 0) {
        const insertValuesString = body.locs
          .map((d, i) => `($1,$${i + 2})`)
          .join(",");
        const insertParams = [user.id, ...body.locs];
        await db.query(
          `INSERT INTO users_to_locations (user_id, location_id) VALUES ${insertValuesString}`,
          insertParams
        );
      }

      // Update user's name in Auth0 if exists and is different
      if (body.name && body.name !== user.name) {
        management.users.update({ id: user.auth0_id }, { name: body.name });
        user.name = body.name;
      }

      // Update user's phone in Auth0 if exists and is different
      if (body.phone && body.phone !== user.phone) {
        await management.users.update(
          { id: user.auth0_id },
          { user_metadata: { phone_number: body.phone } }
        );
        user.phone = body.phone;
      }

      // Gather user's location IDs based on `role_type`
      switch (user.role_type) {
        case "admin": {
          // ADMIN users need all the locations associated with a business
          const lookupAdminLocationsQuery = await db.query(
            `
          SELECT
            l.id
          FROM
            users u
            LEFT JOIN users_to_businesses u2b
              ON u.id = u2b.user_id
            LEFT JOIN businesses b
              ON u2b.business_id = b.id
            LEFT JOIN locations l
              ON b.id = l.business_id
          WHERE
            u.id = $1
            AND u.deleted_at IS NULL
            AND l.deleted_at IS NULL
            AND b.deleted_at IS NULL
          `,
            [user.user_id]
          );
          user.locs = lookupAdminLocationsQuery.rows.map((d) => d.id);
          break;
        }
        case "member": {
          // MEMBER users are explicitly graanted access to particular locations
          const lookupMemberLocationsQuery = await db.query(
            `
          SELECT
            l.id
          FROM
            users u
            JOIN users_to_locations u2l
              ON u.id = u2l.user_id
            JOIN locations l
              ON u2l.location_id = l.id
          WHERE
            u.id = $1
            AND u.deleted_at IS NULL
            AND l.deleted_at IS NULL
          `,
            [user.user_id]
          );
          user.locs = lookupMemberLocationsQuery.rows.map((d) => d.id);
          break;
        }
        default: {
          const error = new Error("Unrecognized `role_type`");
          error.status = 404;
          throw error;
        }
      }

      context.log(JSON.stringify(user, null, 2));

      return {
        body: JSON.stringify(user),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
