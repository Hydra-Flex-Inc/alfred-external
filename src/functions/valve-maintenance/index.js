const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");

app.http("valve-maintenance", {
  methods: ["POST"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      const body = await req.json();

      const validator = new Validator(body, {
        maintenanceId: "required|uuid",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      const out = [];

      // Get the maintenance event info
      const maintenanceEventQuery = {
        text: `
      SELECT
        *
      FROM
        maintenance_events
      WHERE id=$1
        AND deleted_at IS NULL
        AND completed_at IS NULL
      `,
        values: [body.maintenanceId],
      };
      const maintenanceEvent = await db.query(maintenanceEventQuery);

      if (maintenanceEvent.rowCount !== 1) {
        // ERROR OUT
        /*  There should never be more than one row per maintenanceId. Also, each row should be for exactly one
         *  thing (like one valve). HOWEVER, this is only reliably true right now by convention, because the
         *  only existing `event_type` right now is 'valve_predictive'. As we add other types, we will need to
         *  accomodate for each type's distinct requirements.
         */
        const error = new Error(
          "This maintenance event does not exist, was deleted, or replaced by an updated maintenance event."
        );
        error.code = "HTTP_400";
        throw error;
      } else {
        // it is one event, as expected
        const theEvent = maintenanceEvent.rows[0];

        switch (theEvent.event_type) {
          case "valve_predictive": {
            /*  Example `metadata` for `valve_predictive`:
             *  {
             *    "valve": 6,
             *    "total_cycles": 481520,             // total cycles at the time this event was created
             *    "trigger_cycles": 481520            // cycles at which this event was triggered
             *    "completed_cycles": null || number  // cycles at which this event was completed; only set when marking completed
             *  }
             */

            const currentCyclesQuery = {
              text: `
            SELECT
              SUM(cycles_v${theEvent.metadata.valve})::numeric as completed_cycles
            FROM
              valvenode_summary
            WHERE device_id = $1
              AND modbus_id = $2
            `,
              values: [theEvent.iot_hub_device_id, theEvent.modbus_id],
            };
            const currentCycles = await db.tsdbQuery(currentCyclesQuery);

            if (!currentCycles.rowCount) {
              // ERROR OUT
              const error = new Error(
                "Unable to find current cycle count for this maintenance event"
              );
              error.code = "HTTP_500";
              throw error;
            }
            const currentCyclesOnValve = currentCycles.rows[0].completed_cycles;

            const clearEventQuery = {
              text: `
              UPDATE maintenance_events
              SET
                completed_at=now(),
                completing_user_id=$1,
                metadata = jsonb_set(metadata, '{completed_cycles}', $2)
              WHERE id=$3
              RETURNING id, completed_at, completing_user_id`,
              values: [
                authorizedUser.user_id,
                currentCyclesOnValve,
                body.maintenanceId,
              ],
            };
            const update = await db.query(clearEventQuery);
            if (update.rowCount === 1) {
              context.log(
                `Maintenance Event ${body.maintenanceId} was marked completed`
              );
            }
            out.push(update.rows.shift());

            break;
          }
          // ADD OTHER EVENT_TYPES AS NEEDED

          default: {
            const error = new Error("Unknown event_type");
            error.code = "HTTP_400";
            throw error;
          }
        }
      }
      return {
        body: JSON.stringify(out),
        headers: { "Content-Type": "application/json" },
      };
    } catch (error) {
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
