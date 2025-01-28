const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const mail = require("../../../mail");
const { ManagementClient } = require("auth0");
const config = require("../../../config");
config.auth0.scope = "read:users create:user_tickets"; // add the roles we want to use in this context
const management = new ManagementClient(config.auth0);

// Uses auth0_id to get user info from Auth0

/// ///////////////////
// Begin function call
/// ///////////////////
app.http("user-verify-email", {
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
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Ensure that the authorized user is allowed to change this user.
      let user = await Auth.canAccessUser(body.user_id, authorizedUser, db);

      // Retrieve more information about the user from Auth0. In particular, we need the user's email.
      const auth0User = await management.users.get({ id: user.auth0_id });
      user = {
        ...auth0User,
        ...user,
      };

      // generate email verification url via auth0
      const auth0Response = await management.tickets.verifyEmail({
        user_id: user.auth0_id,
        result_url: "https://alfred.hydraflexinc.com/profile",
      });

      // send "email verification" email via sendgrid.
      const message = {
        template_id: mail.config.templateIds.emailVerification,
        personalizations: [
          {
            to: [
              {
                name: user.name,
                email: user.email,
              },
            ],
            bcc: [
              {
                name: "Alfred by Hydra-Flex",
                email: "alfred@hydraflexinc.com",
              },
            ],
            dynamic_template_data: {
              user_email: user.email,
              verify_email_url: auth0Response.ticket,
            },
          },
        ],
      };

      await mail.send(message); // success returns nothing, and error should be caught in catch

      // Return the user that we sent the email to.
      const out = user;

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
