const { app } = require("@azure/functions");
// const db = require("../../../db");
// const Validator = require("../../../validator");
// const Auth = require("../../../auth");
// const ErrorHandler = require("../../../errorHandler");

app.http("adopt-location", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    context.log(`Http function processed request for url "${request.url}"`);

    const name = request.query.get("name") || (await request.text()) || "world";

    return { body: `Hello, ${name}!` };
  },
});
