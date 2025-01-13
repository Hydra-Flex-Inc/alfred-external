const { app } = require("@azure/functions");
const { ManagementClient } = require("auth0");
const parseMultipart = require("parse-multipart");
const db = require("../../../db");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const storageContainer = require("../../../storageContainer");
const config = require("../../../config");
const Common = require("../../../common");
config.auth0.scope = "update:users";
const management = new ManagementClient(config.auth0);

app.http("profile-picture", {
  methods: ["POST", "DELETE"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      const authorizedUser = await Auth.authorizeUser(req, db);

      const user = await Auth.canAccessUser(
        authorizedUser.user_id,
        authorizedUser,
        db
      );

      switch (req.method) {
        case "POST": {
          return await uploadProfilePicture(req, context, user);
          // returning, so break not needed
        }

        case "DELETE": {
          await management.users.update(
            { id: user.auth0_id },
            { user_metadata: { profile_picture: "" } }
          );
          return {
            body: JSON.stringify({ message: "Profile picture deleted" }),
            headers: {
              "Content-Type": "application/json",
            },
          };
        }

        default: {
          const error = new Error("Method does not exist");
          error.code = "HTTP_404";
          throw error;
        }
      }
    } catch (error) {
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});

async function uploadProfilePicture(req, context, user) {
  const bodyBuffer = await streamToBuffer(req.body);
  const contentType = req.headers.get("content-type");
  const boundary = parseMultipart.getBoundary(contentType);
  const parts = parseMultipart.Parse(bodyBuffer, boundary);
  const file = parts[0];

  const imageUrl = await storageContainer.uploadImageToAzure(
    file.data,
    file.filename,
    file.type,
    user.id,
    context
  );

  await management.users.update(
    { id: user.auth0_id },
    { user_metadata: { profile_picture: imageUrl } }
  );

  return { body: JSON.stringify({ profile_picture_url: imageUrl }) };
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
