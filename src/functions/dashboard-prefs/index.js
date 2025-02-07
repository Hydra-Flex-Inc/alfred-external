const { app } = require("@azure/functions");
const db = require("../../../db");
const ErrorHandler = require("../../../errorHandler");
const Auth = require("../../../auth");
const Common = require("../../../common");

// Uses the user id to query dashboard preferences.

app.http("dashboard-prefs", {
  methods: ["GET", "POST"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      switch (req.method) {
        case "GET": {
          return await getDashboardPrefs(req, context, authorizedUser);
          // returning, so break not needed
        }

        case "POST": {
          return await setDashboardPrefs(req, context, authorizedUser);
          // returning, so break not needed
        }
      }
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});

async function getDashboardPrefs(_, context, user) {
  // Since no validation of JSON is needed, directly fetch the user preferences
  const preferencesQuery = await db.query(
    `
    SELECT
      desktop_json,
      mobile_json
    FROM
      dashboard_prefs
    WHERE
      user_id = $1
    `,
    [user.user_id]
  );

  // Check if we have results and return the appropriate response
  if (preferencesQuery.rows.length === 0) {
    // No preferences found
    return {
      status: 404,
      body: JSON.stringify({ error: "No preferences found for the user." }),
    };
  } else {
    // Preferences found, return them
    const preferences = preferencesQuery.rows[0]; // Assuming there's only one row per user
    return {
      body: JSON.stringify(preferences),
    };
  }
}

async function setDashboardPrefs(req, context) {
  // Retrieve the authorized user.
  const authorizedUser = await Auth.authorizeUser(req, db, {
    requireBusinessId: true,
  });
  const body = await req.json();
  // Manually validate the JSON
  const is_valid_desktop_json =
    body.desktop_json && isValidObj(body.desktop_json);
  const is_valid_mobile_json = body.mobile_json && isValidObj(body.mobile_json);

  if (is_valid_desktop_json || is_valid_mobile_json) {
    if (is_valid_desktop_json) {
      // Prepare the upsert query
      const upsert_desktop_json_query = `
        INSERT INTO dashboard_prefs (
          user_id,
          desktop_json
        )
        VALUES
          ($1, $2)
        ON CONFLICT (user_id) DO UPDATE
          SET
            desktop_json = EXCLUDED.desktop_json
      `;

      const upsert_desktop_json_result = await db.query(
        upsert_desktop_json_query,
        [authorizedUser.user_id, JSON.stringify(body.desktop_json)]
      );
      context.log(upsert_desktop_json_result);
    }

    if (is_valid_mobile_json) {
      // Prepare the upsert query
      const upsert_mobile_json_query = `
          INSERT INTO dashboard_prefs (
            user_id,
            mobile_json
          )
          VALUES
            ($1, $2)
          ON CONFLICT (user_id) DO UPDATE
            SET
            mobile_json = EXCLUDED.mobile_json
        `;

      const upsert_mobile_json_result = await db.query(
        upsert_mobile_json_query,
        [authorizedUser.user_id, JSON.stringify(body.mobile_json)]
      );
      context.log(upsert_mobile_json_result);
    }

    const currentPreferencesResult = await db.query(
      `
      SELECT
        desktop_json,
        mobile_json
      FROM
        dashboard_prefs
      WHERE
        user_id = $1
      `,
      [authorizedUser.user_id]
    );

    // Return the success response
    return {
      body: JSON.stringify(currentPreferencesResult.rows[0]),
      headers: {
        "Content-Type": "application/json",
      },
    };
  } else {
    // neither desktop_json nor mobile_json was valid
    const error = new Error(
      "Either desktop_json or mobile_json is required and must be a valid JSON object."
    );
    error.status = 400;
    throw error;
  }
}

function isValidObj(json) {
  return json !== null && typeof json === "object";
}
