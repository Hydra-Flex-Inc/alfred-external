const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const ErrorHandler = require("../../../errorHandler");

// Does not use auth

app.http("vanity-stats", {
  methods: ["GET", "HEAD"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Query up to Sunday and estimate from there to get the query results cached
      // Get current date
      const today = new Date();
      // Calculate the closest Sunday at midnight
      const sunday = new Date(
        new Date(new Date().setDate(today.getDate() - today.getDay())).setHours(
          0,
          0,
          0,
          0
        )
      );
      // Calculate the unixtime of that Sunday
      const sundayUnixtime = Math.floor(sunday.getTime() / 1000);

      const params = [sundayUnixtime];
      // Query the database to determine total cycle count.
      const query = `
    SELECT
      SUM(total_valve_cycles) AS "totalValveCycles",
      SUM(seconds_in_operation) AS "secondsInOperation"
    FROM public.valvenode_summary_vanity_stats_agg
    WHERE total_valve_cycles < $1 -- stop at Sunday at midnight
    `;
      const result = await db.tsdbQuery(query, params);

      const out = result.rows.pop();

      // Calculate time since in minutes
      const timeDifference = Math.floor(
        (today.getTime() - sunday.getTime()) / 60000
      );

      // Do math to determine the total savings.
      // I used more variables than necessary to help document the math.
      const minutesToDate = 26824320; // 2021-01-01 00:00:00, unix time 1609459200
      const unitsToDate = 3446; // Est. 3,466 in operation, 3,866 total sold, per Brandon. As of the "to date" above.
      const unitsSoldPerMinute = 0.0012239979705733; // Avg per minute over last 3 years. 669 in 2018, 766 in 2019, 495 in 2020, per Brandon.
      const dollarsSavedPerUnitPerMinute = 0.0285388127853881; // Avg $15,000 per year, per Brandon.

      // Calculate the estimated total number of units in the field, based on time elapsed since we captured the "units to date".
      const minutesNow = ~~(today.getTime() / 60000);
      const totalUnits =
        unitsToDate +
        ~~((minutesNow - minutesToDate + timeDifference) * unitsSoldPerMinute);

      // Calulate the total amount saved so far this year.
      const beginningOfYear = new Date(today.getFullYear(), 0, 1);
      const minutesAtBeginningOfYear = ~~(beginningOfYear.getTime() / 60000);
      const dollarsSavedPerUnitThisYear = ~~(
        (minutesNow - minutesAtBeginningOfYear + timeDifference) *
        dollarsSavedPerUnitPerMinute
      );
      const dollarsSavedThisYear = totalUnits * dollarsSavedPerUnitThisYear;
      const centsSavedPerSecond = Math.round(
        ((totalUnits * dollarsSavedPerUnitPerMinute) / 60) * 100
      );

      // Add to output.
      out.dollarsSavedThisYear = dollarsSavedThisYear;
      out.centsSavedPerSecond = centsSavedPerSecond;

      return {
        body: JSON.stringify(out),
        headers: { "Content-Type": "application/json" },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
