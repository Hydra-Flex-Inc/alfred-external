const { app } = require("@azure/functions");
const Common = require("../../../common");
const Validator = require("../../../validator");
const cookie = require("cookie");
const ErrorHandler = require("../../../errorHandler");

app.http("remove-cookie", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Only proceed if there is actually a cookie to remove. Otherwise this method
      // can be used to discover that we use an HFI_ALFRED_AUTH_TOKEN cookie, without
      // actually having been logged in.
      const cookies = req.headers.cookie
        ? cookie.parse(req.headers.cookie)
        : {};
      const validator = new Validator(cookies, {
        HFI_ALFRED_AUTH_TOKEN: "required",
      });

      if (validator.fails()) {
        // The Auth Token cookie was not present
        const error = new Error("Unauthorized");
        error.code = "HTTP_401";
        throw error;
      }

      // Set up an expired Auth Token Cookie
      const authTokenCookie = {
        name: "HFI_ALFRED_AUTH_TOKEN",
        value: "", // empty cookie body.
        expires: new Date(1), // Thu, 01 Jan 1970 00:00:00:0001 GMT. Expired attribute is not being respected included in the cookie if you use "0" or "new Date(0)", so I chose "1".
        httpOnly: true, // Makes this cookie unavailable to JavaScript, but along for the ride for free on all requests to this server. Woot!
      };

      // Function to check for the validity of the localhost
      const validLocalhost = () => {
        const valid =
          req?.headers?.origin?.startsWith("https://localhost") &&
          req?.body?.dev_key === process.env.AUTHORIZED_DEV_KEY;
        if (valid) {
          context.log("Authorized a localhost instance");
        }
        return valid;
      };

      // Set the cookie to be secure if we are running in a HTTPS environment (production), and adjust CORS settings.
      if (req.headers["x-forwarded-proto"] === "https" || validLocalhost()) {
        authTokenCookie.secure = true;
        authTokenCookie.sameSite = "none";
      }

      // Return with the cookie in the header.
      return {
        cookies: [authTokenCookie],
        body: "",
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
