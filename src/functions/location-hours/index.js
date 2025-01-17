const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

const processHours = (hours, context) => {
  const out = []; // empty array to store the processed days/hours

  if (!hours || !Array.isArray(hours) || hours.length !== 7) {
    const error = new Error(
      "Invalid hours array. Must be an array of 7 objects, one for each day of the week (1-7)."
    );
    error.status = 400;
    throw error;
  }

  const isValidTimeString = (str) => {
    const hhmm_regex = /^[0-2]\d:[0-5]\d$/;
    if (!hhmm_regex.test(str)) {
      return false;
    }
    const [hours, minutes] = str.split(":");
    return +hours >= 0 && +hours <= 23 && +minutes >= 0 && +minutes <= 59;
  };

  // Loop through the days of the week
  for (let i = 1; i <= 7; i++) {
    const day = hours.find((day) => day.day === i); // Find the day in the hours array

    if (!day) {
      const error = new Error(`Invalid hours array: Missing day ${i}.`);
      error.status = 400;
      throw error;
    } else {
      // we have _something_ for this day... let's check it out

      context.log(`Day ${i} closed: ${day.closed}`);
      // eslint-disable-next-line eqeqeq
      if (typeof day.closed === "undefined" || day.closed == false) {
        // type coercion intended

        day.closed = false; // make it a real boolean

        // not closed, so we need to validate the open and close times
        if (!isValidTimeString(day.open) || !isValidTimeString(day.close)) {
          const error = new Error(
            `Location not closed on day ${i}: Invalid time format for day ${i}. Required format is HH:MM.`
          );
          error.status = 400;
          throw error;
        }
        if (day.open >= day.close) {
          const error = new Error(
            `Location not closed on day ${i}: Open time must be before close time for day ${i}.`
          );
          error.status = 400;
          throw error;
        }
      } else {
        // since closed is true, we don't need open and close times
        day.closed = true;
        day.open = null;
        day.close = null;
      }

      // got this far? must be golden
      out.push(day);
    }
  }

  return out;
};

app.http("location-hours", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user and ensure they are an admin
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
        requireAdminRole: true,
      });

      const body = await req.json();

      // Validation schema for the incoming request
      const validator = new Validator(body, {
        location_id: "required|uuid",
        hours: "required|array",
        "hours.*.day": "required|integer|between:1,7",
        "hours.*.open": "string",
        "hours.*.close": "string",
        "hours.*.closed": "boolean",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Ensure that the authorized user is allowed to update this particular location
      await Auth.canAccessLocation(body.location_id, authorizedUser, db);

      // Validate the hours array
      const processedHours = processHours(body.hours, context);

      if (processedHours.length === 7) {
        // shouldn't need this if since processHours throws an error if it fails

        const hoursQuery = await db.query(
          `
        UPDATE locations
        SET hours = $1
        WHERE locations.id = $2
      `,
          [JSON.stringify(processedHours), body.location_id]
        );

        if (hoursQuery.rowCount !== 1) {
          const error = new Error("UPDATE query unsuccessful");
          error.status = 500;
          throw error;
        }

        // Success response
        return {
          body: JSON.stringify(processedHours),
          headers: { "Content-Type": "application/json" },
        };
      }
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
