const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const ErrorHandler = require("../../../errorHandler");
const jsonwebtoken = require("jsonwebtoken");

// No auth on this so no need to reconfigure

// we may want to move this to an env var or a file to be read, though the latter would mean
// that we'd need to go async to account for the file read
const cert = `-----BEGIN CERTIFICATE-----
MIIC9TCCAd2gAwIBAgIJG39NSoQnUmOOMA0GCSqGSIb3DQEBCwUAMBgxFjAUBgNV
BAMTDWhmaS5hdXRoMC5jb20wHhcNMjAwMTIzMTYzMzM3WhcNMzMxMDAxMTYzMzM3
WjAYMRYwFAYDVQQDEw1oZmkuYXV0aDAuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOC
AQ8AMIIBCgKCAQEAz2Aydsd4/D7oW5ZK6RWjxliIFb8FtbGCNWA42JliZwSK2mzl
pPjRgSQ4nAsbwFMFG6NbVvZjuYMzHsjvuM/On+J58+ylMz7sOt1lsPLDQnqh02Do
ZP6lW+dljKLhNAKiDVBYj671mfpSl7iGtIb7SBwtFlcbqjaNMbzQO7ubOxyYWzj3
mkGEpwFsqygXm8LNLbQcgzMbyegmMJ22qZgv9j8bH5OqNgln6ueHw1h+lry2/piw
dTC7v2xYIT9HqGx2nPFAKq+I8+rxIqykSu2XRlT/TKttjKpRuDJMx9LQBYvmRbzt
7oBQTU89qGANZbRailqH/pTahyx+xDX7Ul5V8wIDAQABo0IwQDAPBgNVHRMBAf8E
BTADAQH/MB0GA1UdDgQWBBRb9Hsrkw7TrF2ActLBaPeqhSBDLDAOBgNVHQ8BAf8E
BAMCAoQwDQYJKoZIhvcNAQELBQADggEBAKp4FjO8C4IppO68/njf9+ZcHL0gYON2
yc2y3yBnBeBjTFmW+Pck7bHkMKtGqN0oE+H8pUOid46pijAwxsW0UrqnXQvbAjkP
MkUTP5FJQpdKzv/RdskRYUzf3NsjS91D/LkYrE53b4mrINTu6if+TkVLsJZ/EwG+
GFIGVE2AzennrykLFBIxvz/Xx0fMMqUmuPqH+Nguq5Jo/ZJ5XCxWcyiorQgIGamq
0UfG6zWEMq9Ow8dl+WzvoBZL/O9NEybJIaeMLBAaHxg/ts/5nlfkqZ0KO5Uw9uY+
VSCMYGzZCvnt/YjJLpXn209scGF5hRNC2u6x2tro0a1KkTEekYVv+3k=
-----END CERTIFICATE-----`;

app.http("set-cookie", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Validate headers
      let validator = new Validator(req.headers, {
        authorization: "required|jwt",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Validate body
      const body = await req.json();

      // Not using a check on uuid, even though the key is a uuid as I do
      // not want to give any indication as to the form of the key
      // Further, the freeflow check prevents code injection as used elsewhere
      validator = new Validator(body, {
        dev_key: "freeflow",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // parse the JWT out of the authorization header.
      const jwt = req.headers.authorization.split(" ").pop();

      // Throws error if...
      // - token cannot be decoded
      // - token has an invalid signature.
      // - token has expired.
      const decodedPayload = jsonwebtoken.verify(jwt, cert, {
        algorithms: ["RS256"],
      });

      // Validate the decoded payload to ensure that we have a sub that is a valid Auth0 ID.
      validator = new Validator(decodedPayload, {
        sub: "required|auth0_id",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Look this user up by auth0Id.
      const auth0Id = decodedPayload.sub;
      const params = [auth0Id];
      let query = `
      SELECT auth_token
      FROM users
      WHERE auth0_id = $1
    `;
      let result = await db.query(query, params);

      // If not found, add to the database
      if (result.rowCount === 0) {
        query = `
        INSERT INTO users ( auth0_id )
        VALUES ( $1 )
        RETURNING auth_token
      `;
        result = await db.query(query, params);
      }

      // Pull the auth token from our db results.
      const authToken = result.rows.shift().auth_token;

      // Set up the Auth Token Cookie
      const authTokenCookie = {
        name: "HFI_ALFRED_AUTH_TOKEN",
        value: authToken,
        maxAge: 3888000, // 45 days
        httpOnly: true, // Makes this cookie unavailable to JavaScript, but along for the ride for free on all requests to this server. Woot!
      };

      // Function to check for the validity of the localhost
      const validLocalhost = () => {
        const valid =
          req?.headers?.origin?.startsWith("https://localhost") &&
          body?.dev_key === process.env.AUTHORIZED_DEV_KEY;
        if (valid) {
          context.log("Authorized a localhost instance");
        }
        return valid;
      };

      // Set the cookie to be secure if we are running in a HTTPS environment (production), and adjust CORS settings.
      // Have a check on the localhost key to see if it is a valid instance of localhost
      // with our shared authorized dev key
      if (req.headers["x-forwarded-proto"] === "https" || validLocalhost()) {
        authTokenCookie.secure = true;
        authTokenCookie.sameSite = "none";
      }

      // Return with the cookie in the header.
      return {
        body: "",
        cookies: [authTokenCookie],
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
