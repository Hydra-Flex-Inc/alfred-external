const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const mail = require("../../../mail");
const { ManagementClient } = require("auth0");
const config = require("../../../config");
config.auth0.scope = "read:users create:users"; // add the roles we want to use in this context
const management = new ManagementClient(config.auth0);

const { v4: uuidv4 } = require("uuid");

/**
 * Look up an Auth0 user in our system
 * @param {string} auth0_id - Auth0's unique identifier
 * @returns {(object|null)} A single user object or null if other than one row was returned
 */
async function getAlfredUser(auth0_id) {
  const predicates = [
    "u.auth0_id = $1",
    "u.deleted_at IS NULL",
    "b.deleted_at IS NULL",
  ];

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
    WHERE ${predicates.join(" AND ")}`,
    [auth0_id]
  );

  let user;
  if (selectUserQuery.rows.length === 0) {
    user = null; // default, representing not found
  } else if (selectUserQuery.rows.length === 1) {
    user = selectUserQuery.rows.shift();
  } else {
    const error = new Error(
      "The number of users with this auth0_id is greater than 1"
    );
    error.status = 403;
    throw error;
  }

  return user;
}

app.http("user-invite", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      // context.log(JSON.stringify(body, null, 2));
      const body = await req.json();
      req = Common.parseRequest(req);
      let authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
        requireAdminRole: true,
      });

      // Validate input
      const validator = new Validator(body, {
        email: "required|email",
        role_type: "required|in:admin,member",
        name: "required|freeflow",
        locs: "array",
      });

      if (validator.fails()) {
        throw validator.errors;
      }
      context.log("Inputs are valid");

      /**********************************************************************
       * Get all the information needed about the authorized user
       * performing this task
       */

      // Retrieve additional information about the "authorizedUser" from Auth0
      // in order to provide social proof in our invitation email.
      const addlInformationAboutAuthorizedUser = await management.users.get({
        id: authorizedUser.auth0_id,
      });
      authorizedUser = {
        ...addlInformationAboutAuthorizedUser,
        ...authorizedUser,
      };

      /**********************************************************************
       * This object is used to gather up all the subject user's information
       */
      let processedSubjectUser = {};

      /**********************************************************************
       * Check to see if the requested email address belongs to
       * an existing user in Auth0
       */
      const possibleSubjectAuth0Users =
        await management.usersByEmail.getByEmail({
          email: body.email.toLowerCase(),
        });

      // We're only concerned with "Username-Password-Authentication" users.
      // Grab the first one if we found any users, otherwise set to null.
      let subjectAuth0User =
        possibleSubjectAuth0Users.data.find(
          (u) =>
            u.identities.find(
              (i) => i.connection === "Username-Password-Authentication"
            ) || null
        ) || null;

      if (subjectAuth0User === null) {
        // User DOES NOT exist in Auth0… we need to add the user to Auth0
        context.log("CREATING Auth0 user");

        // ADD to Auth0
        subjectAuth0User = await management.users.create({
          connection: "Username-Password-Authentication",
          email: body.email.toLowerCase(),
          name: body.name,
          password: uuidv4(), // This is required. Use a random UUID that is not used elsewhere. User will be setting their own password shortly.
        });
        context.log("CREATED Auth0 user");

        // We need to do the following so that newly added Auth0 users will be
        // prompted to change their password immediately upon log-in. This is
        // needed since *we* created their acccount for them so they would have
        // no idea what their password is.

        // FIRST generate password reset url via Auth0
        const auth0Response = await management.tickets.changePassword({
          user_id: subjectAuth0User.user_id, // default property name from Auth0… later we'll use auth0_id
          email: body.email.toLowerCase(),
          mark_email_as_verified: true,
          result_url: "https://alfred.hydraflexinc.com/locations",
        });
        context.log("Password change ticket created");

        // THEN "set" to the ticket URL. This causes the URL to end in #set, which the Auth0
        // reset password template checks for in order to customize verbiage.
        subjectAuth0User.password_reset_url = auth0Response.ticket + "set";
      }
      subjectAuth0User.auth0_id = subjectAuth0User.user_id; // for clarity later

      // AT THIS POINT a valid `subjectAuth0User` should exist
      // ...so append it into `processedSubjectUser`
      processedSubjectUser = {
        ...subjectAuth0User,
      };

      /**********************************************************************
       * Check to see if the user exists in the Alfred system
       */
      let subjectAlfredUser = await getAlfredUser(
        processedSubjectUser.auth0_id
      );
      if (subjectAlfredUser === null) {
        // User DOES NOT exist in Alfred… we need to add the user to Alfred
        context.log("CREATING Alfred user");

        const insertedAlfredUser = await db.query(
          `
        INSERT INTO users ( auth0_id )
        VALUES ( $1 )
        RETURNING *, id as user_id`,
          [processedSubjectUser.auth0_id]
        );
        if (insertedAlfredUser.rows.length !== 1) {
          const error = new Error(
            "Inserting this user into the Alfred system failed"
          );
          error.status = 403;
          throw error;
        }

        // NOW RE-GET the latest Alfred user data... yes, a little wasteful to do this
        // again, but this query is a JOIN and gets us a variety data... this keeps
        // things simple
        subjectAlfredUser = await getAlfredUser(subjectAuth0User.auth0_id);
        context.log("CREATED Alfred user");
      }
      // AT THIS POINT a valid `subjectAlfredUser` should exist
      // ...so append it into `processedSubjectUser`
      processedSubjectUser = {
        ...processedSubjectUser,
        ...subjectAlfredUser,
      };
      context.log("AUTH0 AND ALFRED WORK COMPLETED");

      /*********************************************************************************
     BY THIS POINT we have a `processedSubjectUser` object that has all the latest
     Auth0 and Alfred user data that we have, whether pre-existing or brand new
    /********************************************************************************/
      context.log(JSON.stringify(processedSubjectUser, null, 2));

      // Find out whether this user already belongs to a Business
      if (processedSubjectUser.business_id) {
        // already has a business_id
        if (processedSubjectUser.business_id !== authorizedUser.business_id) {
          // not the right one?
          const error = new Error("This user already belongs to a business.");
          error.status = 403;
          throw error;
        }
      } else {
        // needs to be associated with the authorized user's Business
        const addedBusiness = await db.query(
          `
        INSERT INTO users_to_businesses(
          user_id,
          business_id,
          role_type
        )
        VALUES(
          $1,
          $2,
          $3
        )
        RETURNING *`,
          [
            processedSubjectUser.user_id,
            authorizedUser.business_id,
            body.role_type || "member", // use the supplied role_type or default to member.
          ]
        );

        processedSubjectUser = {
          ...processedSubjectUser,
          ...addedBusiness.rows[0], // will overwrite `business_id` and `role_type`
        };
      }

      // Add users_to_locations is this is a "member" `role_type`
      if (processedSubjectUser.role_type === "member") {
        // First eliminate all potentially pre-existing users_to_locations for this user,
        // so that we don't unintentionally grant unexpected access
        await db.query(`DELETE FROM users_to_locations WHERE user_id = $1`, [
          processedSubjectUser.user_id,
        ]);

        // then add any selected locations
        if (req?.body?.locs?.length > 0) {
          const insertValuesString = body.locs
            .map((d, i) => `($1,$${i + 2})`)
            .join(",");
          const insertParams = [processedSubjectUser.user_id, ...body.locs];
          await db.query(
            `INSERT INTO users_to_locations (user_id, location_id) VALUES ${insertValuesString}`,
            insertParams
          );
        }
      }

      /*********************************************************************************
     NOW we have a user that is part of a business. We need to tailor the email to the
     customer based on whether they are brand new to the whole system or have logged
     in Alfred before but are simply newly being added to a team.
    /********************************************************************************/

      let message = {}; // the message template that will go to SendGrid
      if (processedSubjectUser.password_reset_url) {
        // present if this is a new Auth0 account
        message = {
          template_id: "d-c36e36d77b5047ae8ae856d50faed545", // "Welcome Invitation" SendGrid Dynamic Template
          personalizations: [
            {
              to: [
                {
                  name: processedSubjectUser.name,
                  email: processedSubjectUser.email,
                },
              ],
              bcc: [
                {
                  name: "Alfred by Hydra-Flex",
                  email: "alfred@hydraflexinc.com",
                },
              ],
              dynamic_template_data: {
                user_name: processedSubjectUser.name,
                password_reset_url: processedSubjectUser.password_reset_url,
                business_name: authorizedUser.business_name,
                invited_by: authorizedUser.name,
              },
            },
          ],
        };
      } else {
        message = {
          template_id: "d-2417b4c32cd0476f80e602976fb5161a", // "Added to Team" SendGrid Dynamic Template
          personalizations: [
            {
              to: [
                {
                  name: processedSubjectUser.name,
                  email: processedSubjectUser.email,
                },
              ],
              bcc: [
                {
                  name: "Alfred by Hydra-Flex",
                  email: "alfred@hydraflexinc.com",
                },
              ],
              dynamic_template_data: {
                user_name: processedSubjectUser.name,
                business_name: authorizedUser.business_name,
                invited_by: authorizedUser.name,
              },
            },
          ],
        };
      }

      context.log("About to send mail");
      await mail.send(message);

      return {
        body: JSON.stringify(processedSubjectUser),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
