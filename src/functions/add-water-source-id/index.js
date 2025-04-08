const { app } = require("@azure/functions");
const db = require("../../../db.js");
const ErrorHandler = require("../../../errorHandler");

app.http("add-water-source-id-data", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      const body = await req.json();
      const { water_source_id, component_id } = body;

      const query = `
        UPDATE components
        SET water_source_id = $1
        WHERE id = $2
        RETURNING *;
      `;
      const params = [water_source_id, component_id];

      const component = await db.query(query, params);

      return {
        body: JSON.stringify(component.rows),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
