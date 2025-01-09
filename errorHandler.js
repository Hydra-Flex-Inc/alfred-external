/* eslint-disable space-before-function-paren */
const Validator = require("./validator");

module.exports = {
  /*
   * This function is intended to prepare a response with a JSON error payload
   * based on a Javascript error that reaches the top of the call stack.
   */
  prepareResponse(context, error) {
    const out = {
      status: 500,
      body: { error: "An error occurred" },
      headers: {
        "Content-Type": "application/json",
      },
    };

    // Check to see if this is a validation errors object.
    if (error instanceof Validator.Errors) {
      out.status = 400;
      out.body.error = "Validation error(s)";
      out.body.validator_errors = error.all();
    } else if (error instanceof Error) {
      context.error(error.stack);

      const code = error?.code || null;
      if (code?.startsWith("HTTP_")) {
        // is a string which starts with HTTP_
        out.status = +code.split("_").pop();
        out.body.error = error.message;
      } else if (Number.isFinite(+code) && +code >= 400 && +code <= 599) {
        out.status = +code;
        out.body.error = error.message;
      }
      // by default, leave the 500 and grab the error message
      out.body.error = error.message;
    } else {
      out.body.error = error; // assume this is a simple string
    }

    context.log("out", out);

    return out;
  },
};
