const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

// Limit per query is 50 users
const AUTH0_QUERY_USER_SIZE = 50;

const { ManagementClient } = require("auth0");
const config = require("../../../config");
config.auth0.scope = "read:users"; // add the roles we want to use in this context
const management = new ManagementClient(config.auth0);

app.http("users", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const auth0User = await Auth.authorizeUser(req, db);

      const params = [auth0User.business_id];
      const predicates = [
        "b.id = $1",
        "u.deleted_at IS NULL",
        "b.deleted_at IS NULL",
      ];

      const query = `
      SELECT
        u.id as user_id,
        u.auth0_id,
        u.system_alerts_block_list,
        u.wants_email,
        u.wants_push,
        u2b.role_type
      FROM
        users u
        JOIN users_to_businesses u2b
          ON u.id = u2b.user_id
        JOIN businesses b
          ON u2b.business_id = b.id
      WHERE ${predicates.join(" AND ")}
    `;
      const userQuery = await db.query(query, params);

      if (userQuery.rowCount === 0) {
        const error = new Error("No users found.");
        error.code = "HTTP_404";
        throw error;
      }

      const users = userQuery.rows;

      const auth0Ids = users.map((u) => u.auth0_id);
      const auth0Users = [];

      const batchedQuery = [];
      // Group the users into batches of the chunk size or less to determine the number of queries
      for (let i = 0; i < auth0Ids.length; i += AUTH0_QUERY_USER_SIZE) {
        const chunk = auth0Ids.slice(i, i + AUTH0_QUERY_USER_SIZE);
        const query = `user_id:"${chunk.join('" OR user_id:"')}"`;
        // batchedQuery.push(management.getUsers({ q: query, search_engine: 'v3' }));
        batchedQuery.push(
          await management.users.getAll({ q: query, search_engine: "v3" })
        );
      }

      // Wait for the parallel async queries to all return successfully
      // If not, then the function errors out cause we have no users
      await Promise.all(batchedQuery)
        .then((values) => {
          // Destructure 2D Array to get the Auth0 individual user return
          for (const arr of values) {
            for (const val of arr.data) {
              auth0Users.push(val);
            }
          }
        })
        .catch((error) => {
          const errorRes = new Error("Auth0 User Fetch Issue", error);
          errorRes.code = "HTTP_500";
          throw errorRes;
        });

      // Merge Database & Auth0 data.
      const out = {
        users: [],
      };

      for (const user of users) {
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
            LEFT JOIN users_to_locations u2l
              ON u.id = u2l.user_id
            LEFT JOIN locations l
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
            error.code = "HTTP_404";
            throw error;
          }
        }

        out.users.push({
          ...auth0Users.find((u) => u.user_id === user.auth0_id),
          ...user,
        });
      }

      // Sort users by name, then email.
      out.users.sort(function (userA, userB) {
        // Primary sort by name. Note: Auth0 seems to default the name to the email address, if not explicitly collected)
        const nameA = userA.name.toUpperCase(); // ignore upper and lowercase
        const nameB = userB.name.toUpperCase(); // ignore upper and lowercase
        if (nameA < nameB) {
          return -1;
        }
        if (nameA > nameB) {
          return 1;
        }

        // Secondary sort by email address.
        const emailA = userA.email.toUpperCase(); // ignore upper and lowercase
        const emailB = userB.email.toUpperCase(); // ignore upper and lowercase
        if (emailA < emailB) {
          return -1;
        }
        if (emailA > emailB) {
          return 1;
        }

        // name & email must be equal
        return 0;
      });
      return {
        body: JSON.stringify(out),
        headers: { "Content-Type": "application/json" },
      };
    } catch (error) {
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
