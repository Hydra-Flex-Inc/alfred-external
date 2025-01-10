const { app } = require("@azure/functions");
const db = require("../../../db");
const Validator = require("../../../validator");
const Auth = require("../../../auth");
const ErrorHandler = require("../../../errorHandler");
const ParseRequest = require("../../../parseRequest");

const containerFullLevel = 40;

const containerEmptyLevel = 864;

const fillThresholdPercent = 0.8;

const numOfDataPoints = 180;

const containerCharacteristics = {
  bullseye: {
    gals: 13,
    refillGals: 2.5,
    mmInputMin: 350,
    mmPerGal: 38,
  },
  15: {
    gals: 15,
    refillGals: 15,
    mmInputMin: 304,
    mmPerGal: 36.5,
  },
  30: {
    gals: 30,
    refillGals: 30,
    mmInputMin: 300,
    mmPerGal: 20,
  },
};

const roundToNumber = (value, decimals) => {
  let out = null;
  value = +value;
  if (Number.isFinite(value)) {
    out = +value.toFixed(decimals);
  }
  return out;
};

const containerPercentCalculator = (value, inputMin) => {
  let out = null;
  if (Number.isFinite(value)) {
    const inputMax = containerEmptyLevel;
    const outputMin = 0;
    const outputMax = 100;
    out =
      ((value - inputMin) * (outputMax - outputMin)) / (inputMax - inputMin) +
      outputMin;
    if (out < 0) {
      out = 0;
    }
    if (out > 100) {
      out = 100;
    }
    out = 100 - out;
  }
  return out;
};

const containerVolumeCalculator = (value, mmPerGal) => {
  let out = null;
  if (Number.isFinite(value)) {
    out = (containerEmptyLevel - value) / mmPerGal;
  }
  return out;
};

const mmDraw = (levelTrend) => {
  // Add up all of the _increases_ in distance
  const values = levelTrend.map((row) => row.dist_mm); // grab just the mm readings
  const total_mm_draw = values.reduce((mem, cur, i, array) => {
    const previous_value = array[i - 1] || 0;
    if (previous_value > cur) {
      return mem + (cur - array[i - 1]); // add it to the total usage
    } else {
      // the value doesn't represent more usage, so...
      return mem; // just return the total usage unmodified
    }
  }, 0);
  return Math.abs(total_mm_draw);
};

const mmFill = (levelTrend) => {
  // Selectively add up all of the _decreases_ in distance
  const buffer = 20; // mm... weed out small variations
  const values = levelTrend.map((row) => row.dist_mm); // grab just the mm readings
  const total_mm_fill = values.reduce((mem, cur, i, array) => {
    const previous_value = array[i - 1] || 0;
    if (previous_value + buffer < cur) {
      return mem + (cur - previous_value); // add it to the total usage
    } else {
      // the value doesn't represent more usage, so...
      return mem; // just return the total usage unmodified
    }
  }, 0);
  return Math.abs(total_mm_fill - values[0]);
};

const mapToRange = (value, inMin, inMax, outMin, outMax) =>
  ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;

const buildFillPeriod = (startObj, endObj, levelReadings) => {
  return {
    start: {
      index: startObj.index,
      time: startObj.time,
      dist_mm: startObj.value,
      proportion_full: startObj.proportion_full,
    },
    end: {
      index: endObj.index,
      time: endObj.time,
      dist_mm: endObj.value,
      proportion_full: endObj.proportion_full,
    },
    mm_used: endObj.value - startObj.value, // appears reversed because "emptier" reads as higher number
    proportion_used: startObj.proportion_full - endObj.proportion_full,
    mm_filled: startObj.mm_filled, // amount filled from previous period in order to begin this period
    readings: levelReadings.slice(startObj.index, endObj.index),
  };
};

app.http("chem-sense", {
  methods: ["GET"],
  handler: async (req, context) => {
    try {
      req = ParseRequest.parse(req);
      // req.headers.forEach((value, name) => {
      //   if (name === "cookie") {
      //     req.headers.cookie = value;
      //   }
      // });
      // req.query = Object.fromEntries(req.query.entries());

      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      // Validate input.
      const validator = new Validator(req.query, {
        gatewayId: "required|alpha_dash",
        start: "iso8601",
        end: "iso8601",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Ensure that the authorized user is allowed to see this particular device ID.
      await Auth.canAccessDevice(req.query.gatewayId, authorizedUser, db);

      const out = {};

      const gatewayId = req.query.gatewayId || null;
      const start = req.query.start || null;
      const end = req.query.end || null;

      const functionalEndDateTime = end || new Date().toISOString();

      // Query the data using the LTTB method, which is a method that takes the general shape of the data
      // and reduces the amount of data returned while maintaining the integrity of the data.

      const levelTrendQuery = `
      SELECT
        LOWER(device_id) AS device_id,
        (unnest(lttb(time, dist_mm, ${numOfDataPoints}))).time,
        (unnest(lttb(time, dist_mm, ${numOfDataPoints}))).value AS dist_mm
      FROM
        level_sense_state
      WHERE
        gateway_id = $1
        AND time BETWEEN $2::timestamptz
                     AND $3::timestamptz
        AND dist_mm IS NOT NULL 
        AND dist_mm BETWEEN ${containerFullLevel} AND ${containerEmptyLevel}
      GROUP BY
        device_id
      `;

      const queryValues = [gatewayId, start, functionalEndDateTime];
      const levelTrend = await db.tsdbQuery(levelTrendQuery, queryValues);

      // Filter out all the duplicate device_ids and create placeholders.
      const uniqueDeviceIds = Array.from(
        new Set(levelTrend.rows.map((d) => d.device_id))
      );

      const deviceIdPlaceholders = uniqueDeviceIds
        .map((_, i) => `$${i + 2}`)
        .join(", ");

      // Query the data
      // currentLevelQuery queries a materialized view, returning the all the data from the specified device IDs.

      const currentLevelQuery = `
        SELECT DISTINCT ON (device_id) 
          time,
          LOWER(device_id) AS device_id,
          dist_mm
        FROM
          most_recent_chem_sense_level
        WHERE
          gateway_id = $1
          AND device_id IN (${deviceIdPlaceholders})
          AND dist_mm IS NOT NULL
        ORDER BY
          device_id,
          time DESC
        `;

      // Using the gateway ID query the chemical_containers and level_sensors tables to
      // return the associated sensors connected to each container

      const chemicalContainersQuery = `
        SELECT
          ARRAY_AGG(ls.id) AS level_sensor_ids,
          ARRAY_AGG(LOWER(ls.mac_address::varchar)) AS level_sensor_mac_addresses,
          cc.*
        FROM chemical_containers cc
          LEFT JOIN chemical_containers_to_level_sensors cc2ls
            ON cc.id = cc2ls.chemical_container_id
          LEFT JOIN LEVEL_SENSORS ls
            ON ls.id = cc2ls.level_sensor_id
        WHERE
          cc.IOT_HUB_DEVICE_ID = $1
          AND cc.deleted_at IS NULL
          AND cc2ls.deleted_at IS NULL
          AND ls.deleted_at IS NULL
        GROUP BY
          cc.id
        ORDER BY
          cc.name ASC
      `;

      // Using the Gateway ID find all the wash packages connected to the containers

      const washPackagesQuery = `
        SELECT
          cc.id AS container_id,
          ARRAY_AGG(cwp2cc.car_wash_package_id) AS package_ids
        FROM chemical_containers cc
          LEFT JOIN car_wash_packages_to_chemical_containers cwp2cc
            ON cc.id = cwp2cc.chemical_container_id
        WHERE
          cc.iot_hub_device_id = $1
          AND cc.deleted_at IS NULL
          AND cwp2cc.deleted_at IS NULL
        GROUP BY cc.id
        `;

      await Promise.all([
        // tsdbQuery queries a materialized view, which results in a quicker query.
        // It retrieves the most recent non-null distance measurement for each unique device ID,
        // filtered by a specific gateway ID and a list of device IDs.
        db.tsdbQuery(currentLevelQuery, [
          gatewayId,
          ...uniqueDeviceIds.map((u) => u.toUpperCase()),
        ]),
        db.query(chemicalContainersQuery, [gatewayId]),
        db.query(washPackagesQuery, [gatewayId]),
      ])
        .then((values) => {
          const currentLevel = values[0]?.rows;
          const queriedContainers = values[1]?.rows;
          // To ensure that levelTrend has data that queriedContainers can use.
          // We're going to filter queriedContainers using the device_id in levelTrend.
          const validDeviceIds = new Set(
            levelTrend.rows.map((device) => device.device_id)
          );
          const containers = queriedContainers.filter((container) =>
            container.level_sensor_mac_addresses.some((macAddress) =>
              validDeviceIds.has(macAddress)
            )
          );
          const washPackageIds = values[2]?.rows;

          containers.forEach((container) => {
            // If container_type is null then use the value of container_size_gals.
            // We do this because when the container type is being determined the value is null if it is a bullseye.
            if (container.container_type === null) {
              container.container_type = container.container_size_gals;
            }

            // Next we're going to add some characteristics about the container.
            container.characteristics = {
              mmInputMin:
                containerCharacteristics[container.container_type]
                  ?.mmInputMin ?? 1,
              mmPerGal:
                containerCharacteristics[container.container_type]?.mmPerGal ??
                1,
              containerGals:
                containerCharacteristics[container.container_type]?.gals ?? 1,
              refillGals:
                containerCharacteristics[container.container_type]
                  ?.refillGals ?? 1,
            };

            // Then, we'll grab the current levels for this container from currentLevel and add them,
            // as well as some calculations about those readings to the container.
            const latestReadingForThisContainer = currentLevel.find((d) =>
              container.level_sensor_mac_addresses.includes(d.device_id)
            );

            // Add last_report_time from the time field.
            container.lastReportTime =
              latestReadingForThisContainer?.time || null;

            // Add mm_latest_reading from the dist_mm field.
            container.mmLatestReading =
              latestReadingForThisContainer?.dist_mm || null;

            // Convert mm_latest_reading to a percentage of how full the container is
            // and store that value in the pct_latest_reading field.
            container.pctLatestReading =
              roundToNumber(
                containerPercentCalculator(
                  container.mmLatestReading,
                  container.characteristics.mmInputMin
                ),
                1
              ) || null;

            // Convert mm_latest_reading to the number of gallons that are left in the container
            // and store that value in the gal_latest_reading field.
            container.galLatestReading =
              roundToNumber(
                containerVolumeCalculator(
                  container.mmLatestReading,
                  container.characteristics.mmPerGal
                ),
                5
              ) || null;

            // Calculate the cost of each milliliter of chemical
            // and store that value in the cost_per_milliliter field.
            container.costPerMilliliter = roundToNumber(
              (container.container_cost / container.container_size_gals) *
                3785.41,
              2
            );

            // Add the start and end date fields to the container using the query start and end parameters.
            container.start = start || null;
            container.end = functionalEndDateTime;

            /*
          Now we'll add some trend data to the container. This is from the first query we ran,
          which returned the data about the levels for each container. This data was generated
          using the LTTB method, which maintains the original shape of the data,
          but with far fewer data points.

          We will also add some fields that will help us in some future calculations. The fields are:

            index: Simply the number the object is in the array. Later on there will be grouping of
            objects that will depend on this index to calculate time periods.

            proportion_full: This is a property that represents how full the container is relative
            to the sense-able range, not necessarily to what is considered a “full” container in real use.
            This gives us a reliable absolute proportion to do subsequent math on.

            is_prediction: This field is equal to false for each these real readings,
            as we'll make predicted reading later.
          */

            const trendData = levelTrend.rows.filter((reading) =>
              container.level_sensor_mac_addresses.includes(reading.device_id)
            );

            trendData.forEach((d, i) => {
              d.index = i;
              d.proportion_full = mapToRange(
                d.dist_mm, // the actual value
                containerFullLevel,
                containerEmptyLevel, // sense-able min and max of the container
                1,
                0 // output range to be 1...0 where 1.0 is full and 0.0 is empty
              );
              d.is_prediction = false; // tag this as real data, not predicted data

              return d;
            });

            container.levelTrend = trendData.map((d) =>
              // Doing this to remove device_id from each row, since this
              // will exist in the context of the device/container...
              // saves a lot of bytes on the wire
              ({
                time: d.time,
                value: d.dist_mm,
                index: d.index,
                proportion_full: d.proportion_full,
                is_prediction: d.is_prediction,
              })
            );

            // We'll use trendData and add some calculations that
            // detail the current state of the container.

            // Calculate the number of millimeters the container used over the time
            // period specified and save that value in the mmUsed field.
            container.mmUsed = roundToNumber(mmDraw(trendData), 2);

            // Convert the millimeters used to gallons used and save that field in the gallonsUsed field.
            container.gallonsUsed = roundToNumber(
              container.mmUsed / container.characteristics.mmPerGal,
              5
            );

            // Calculate the number of millimeters that were added to the container over the time period
            // specified and save that value in the mmFilled field.
            container.mmFilled = roundToNumber(mmFill(trendData), 2);

            // Convert the millimeters filled to gallons filled and save that field in the gallonsFilled field.
            container.gallonsFilled = roundToNumber(
              container.mmFilled / container.characteristics.mmPerGal,
              5
            );

            /*
          When a container is refilled it is filled by containers that have a set amount in them.
          This characteristic has been preconfigured for each container type.
          This field divides the gallons filled by that characteristic.
          As a result we get the number of refill units that have been added to the container
          over the specified period of time. That value is saved in the refillUnits field.
          */
            container.refillUnits = Math.round(
              container.gallonsFilled / container.characteristics.refillGals
            );

            // The next item we'll add are wash package IDs connected to this container.
            const washPackagesForThisContainer = washPackageIds.find(
              (d) => d.container_id === container.id
            ) || { package_ids: [] };
            container.washPackages = washPackagesForThisContainer.package_ids;

            /*
          Now we are going to add some predictive data that will show an estimated date the
          container will be empty. We'll also calculate data that can be put in a chart and
          show the level of the container within the specified dates and predict a future
          line the container will follow till it is empty.
          */

            /*
          USAGE PERIODS
          Usage periods are a time period starting with a filled state (or the start of the available data) and ending with the lowest fill level before the next filled state begins (or the end of the available data). Each usage period should have:

            start: index, time, dist_mm (actual level), and proportion_filled
            end: index, time, dist_mm (actual level), and proportion_filled
            mm_used during the period
            mm_filled to begin the period
            readings is the array of the original time series data

          First, we identify which sensor readings are fill events, meaning the measured distance
          from the top of the drum to the surface of the chemical reduced a large enough amount to
          appear to have been a refill.
          */

            const fillEventChangeThreshold = 20;
            const fillEvents = [];
            container.levelTrend.forEach((l, i) => {
              const previous_level = container.levelTrend[i - 1]?.value || 40; // explain this default value
              if (!previous_level) {
                console.log("previous_level", previous_level);
              }
              const mm_changed = previous_level - l.value;
              if (mm_changed >= fillEventChangeThreshold) {
                l.mmFilled = mm_changed;
                fillEvents.push(l);
              }
            });

            // Now that we have fill events defined, use them to slice the level readings up into usage periods.
            const usage_periods = [];
            const levelReadings = container.levelTrend;

            if (fillEvents.length === 0) {
              // if no fill events were found, then just build a single period from the whole span of data
              usage_periods.push(
                buildFillPeriod(
                  levelReadings[0], // start of whole period
                  levelReadings[levelReadings.length - 1], // end of whole period
                  levelReadings
                )
              );
            } else {
              // there are fill events, so...

              // create a set of reliable start and end indexes for each period
              const fillEventIndexes = fillEvents.map((d, i) => {
                return {
                  start: fillEvents[i - 1]?.index || 0, // get previous index, or use zero if there is no previous index
                  end: d.index - 1, // minus one because d.index will *begin* the next period
                };
              });
              // add the closing usage event indexes
              fillEventIndexes.push({
                // for start, grab the index from last one and add one (which had been subtracted)
                start: fillEventIndexes[fillEventIndexes.length - 1].end + 1,
                end: levelReadings.length - 1, // end of readings
              });

              // populate usage_periods
              fillEventIndexes.forEach((d) => {
                usage_periods.push(
                  buildFillPeriod(
                    levelReadings[d.start],
                    levelReadings[d.end],
                    levelReadings
                  )
                );
              });
            }

            /*
          Now that we have well-defined usage periods, we can process them to
          discover a couple of interesting things:

            What is the “average slope” or “average usage per day”?
            How many refill containers or units were used during this time period?

          AVERAGE USAGE PER DAY
          Each usage period will have an average chemical usage per day. Since millimeters
          are the core unit of measurement, we'll calculate this as “average mm used per day”.
          Over a long enough time there may be multiple usage periods, each having it's own
          average chemical usage per day. We'll average those by number of usage periods in
          hopes of having a number that covers varying recent traffic conditions.
          */

            const dayInMs = 24 * 60 * 60 * 1000;
            const mmUsedPerDayPerPeriod = [];

            usage_periods.forEach((d) => {
              const periodInMs = d.end.time - d.start.time;
              const periodInDays = periodInMs / dayInMs;
              const mmUsedPerDay = d.mm_used / periodInDays || 0;
              mmUsedPerDayPerPeriod.push(mmUsedPerDay);
            });

            const avg_mm_used_per_day =
              mmUsedPerDayPerPeriod.reduce((acc, cum) => acc + cum, 0) /
              mmUsedPerDayPerPeriod.length;

            // Now that we have an average chemical usage per day, we can use that to estimate the
            // future levels down to when the container would be empty. For now we're sticking
            // with the mm values for all of the math.

            // "prediction start" is the end of the last usage period, which is essentially the current moment
            const predictionStartTime =
              usage_periods[usage_periods.length - 1].end.time;
            const predictionStartDistMm =
              usage_periods[usage_periods.length - 1].end.dist_mm;

            const readings = [];
            const intervalHours = 8; // set this to the number of hours we step into the future per loop
            const intervalMmUsed = (avg_mm_used_per_day * intervalHours) / 24;
            // loop into the future until the container will be empty, incrementing i and adding the interval's average calculated mm used
            for (
              let i = 0, d = predictionStartDistMm;
              d < containerEmptyLevel;
              i++, d += intervalMmUsed
            ) {
              if (readings.length <= 90) {
                readings.push({
                  time: new Date(
                    predictionStartTime.getTime() +
                      i * intervalHours * 60 * 60 * 1000
                  ),
                  dist_mm: d,
                });
              } else {
                d = containerEmptyLevel;
              }
            }

            const prediction = {
              estimated_empty_day: readings[readings.length - 1]?.time,
              readings,
            };

            const refills_used = usage_periods
              .map((d) => {
                const rawContainersUsed =
                  d.mm_filled /
                    container.characteristics.mmPerGal /
                    container.characteristics.refillGals || 0;
                const roundedContainersUsed = Math.round(
                  rawContainersUsed / fillThresholdPercent
                );
                return roundedContainersUsed;
              })
              .reduce((acc, cum) => acc + cum, 0);

            const slopePrediction = {
              usage_periods,
              refills_used,
              avg_mm_used_per_day,
              prediction,
            };
            container.slope_prediction = slopePrediction;

            // We'll do a little cleanup by removing some unneeded fields, add our slope
            // prediction data, and end up with our container with all the necessary data attached.

            delete container.sensors;
            delete container.created_at;
            delete container.deleted_at;
          });
          out.containers = containers;
        })
        .catch((err) => {
          throw new Error(err);
        });

      return { body: JSON.stringify(out) };
    } catch (error) {
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
