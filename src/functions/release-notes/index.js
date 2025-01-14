const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

const getReleaseNotes = async (authorizedUser) => {
  const releaseNotesQuery = {
    text: `SELECT r.id as release_id,
      r.release_version,
      r.release_date,
      r.is_active,
      rn.id,
      rn.note_type,
      rn.note
    FROM releases r
    LEFT JOIN release_notes rn ON rn.release_id = r.id
    WHERE r.release_app = 'web'
      AND r.deleted_at IS NULL
      AND rn.deleted_at IS NULL
      ${
        authorizedUser.role_type === "admin"
          ? ""
          : `AND ( rn.role_scope = 'member' OR rn.role_scope IS NULL)`
      }
      ORDER BY r.release_date DESC,
        r.release_version DESC,
        CASE WHEN rn.note_type = 'feature' THEN 1
                  WHEN rn.note_type = 'improvement' THEN 2
                  WHEN rn.note_type = 'bug' THEN 3
                  WHEN rn.note_type = 'known' THEN 4
                  ELSE 5 END ASC
    `,
  };
  const releaseNotes = await db.query(releaseNotesQuery);
  return releaseNotes.rows;
};

const createReleaseNotes = async (req) => {
  // Return a not implemented
  const error = new Error("Not Implemented");
  error.code = "HTTP_501";
  throw error;
};

app.http("release-notes", {
  methods: ["GET", "POST"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      // Simple switch to call the correct handling function for both accepted methods
      let out = null;
      if (req.method === "GET") {
        out = await getReleaseNotes(authorizedUser);
      } else if (req.method === "POST") {
        out = await createReleaseNotes(req);
      } else {
        // This should not happen as Azure APIM protects against this, but as a failsafe
        const error = new Error("Method does not exist");
        error.code = "HTTP_404";
        throw error;
      }

      return {
        body: JSON.stringify(out),
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
