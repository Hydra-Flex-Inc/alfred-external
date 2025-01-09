/*
 * Set up the validator for our API.
 * Documentation available here. https://github.com/mikeerickson/validatorjs
 *
 * ValidatorJS takes inspiration from Laravel validation. Documentation available here https://laravel.com/docs/8.x/validation
 */

// Import the vanilla ValidatorJS validator & Errors class.
const Validator = require("validatorjs");
const Errors = require("validatorjs/src/errors");

// Tie Errors prototype to the Validator, so we only need to include our (slightly customized) Validator down the road.
Validator.Errors = Errors;

/*
 * Register custom validation types below.
 */

// Validate that a given string is a UUID.
Validator.register(
  "uuid",
  function (value) {
    // This should work for v1-5 UUID, the nil UUID, and theoretically, any future versions
    // having the pattern 8-4-4-4-12 hexidecimal characters. Could make this stricter as the lead
    // character of the 3rd & 4th grouping of 4 characters have fewer valid values, but this should
    // be plenty sufficient for our needs.
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    );
  },
  "The :attribute field must be a UUID."
);

// Validate that a given string is a ISO8601 date string.
Validator.register(
  "iso8601",
  (value) => {
    const ISO_8601_FULL =
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(([+-]\d\d:\d\d)|Z)?$/i;
    return ISO_8601_FULL.test(value);
  },
  "The :attribute field must be a valid ISO8601 string."
);

// Validate that a given string is a JWT token.
Validator.register(
  "jwt",
  function (value) {
    // Value must have all 3 "sections" of a full JWT token.
    // Information about JWT structure here: https://jwt.io/
    // Optionally, allow to begin with the string "Bearer ", as in an Authorization header.
    return /^(Bearer )?[a-z0-9-_+/=]+\.[a-z0-9-_+/=]+\.?[a-z0-9-_+/=.]*$/i.test(
      value
    );
  },
  "The :attribute field must be a JWT token."
);

// Validate that a given string is an Auth0 ID.
Validator.register(
  "auth0_id",
  function (value) {
    return /^auth0\|\w+$/i.test(value);
  },
  "The :attribute field must be a Auth0 ID."
);

// Custom validation that will reject freeflow text containing characters or patterns
// that should not be necessary for user provided text data.
Validator.register(
  "freeflow",
  function (value) {
    // One of the most common building blocks of XSS attacks.
    if (value.includes("javascript:")) {
      return false;
    }

    // deny input that contains common characters used in XSS or SQL injection attacks, which should not be needed in our application.
    return /^[^<>{};=]+$/i.test(value);
  },
  "The :attribute field contains special characters which are not allowed."
);

// Validate that a given string is a valid phone number.
Validator.register(
  "phone",
  function (value) {
    return /^\+?[0-9]+$/i.test(value);
  },
  'The :attribute field must be a valid phone number having only numbers and an optional leading "+" sign.'
);

// Export the modified Validator.
module.exports = Validator;
