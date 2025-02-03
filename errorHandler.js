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

      // This was previusly defualting to null if there was no status
      // However, that was preventing the function from returning details about the error.
      out.status = error?.status || 500;
      out.body.error = error.message;
    } else {
      out.body.error = error; // assume this is a simple string
    }
    out.body = JSON.stringify(out.body);
    context.log("out", out);

    return out;
  },
};
