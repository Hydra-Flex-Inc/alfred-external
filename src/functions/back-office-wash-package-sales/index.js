const { app } = require("@azure/functions");
const axios = require("axios");
const https = require("https");
const Auth = require("../../../auth");
const db = require("../../../db");
const Validator = require("../../../validator");
const ErrorHandler = require("../../../errorHandler");
const ParseRequest = require("../../../parseRequest");

app.http("back-office-wash-package-sales", {
  methods: ["GET"],
  handler: async (req, context) => {
    context.log("Processing request to calculate cost per wash.");
    try {
      req = ParseRequest.parse(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      const validator = new Validator(req.query, {
        lid: "required|uuid",
        start: "required|iso8601",
        end: "required|iso8601",
        dateFormat: "required|in:month,day,hour",
      });

      if (validator.fails()) {
        throw validator.errors;
      }

      // Extract parameters from the request query string
      const { start, end, dateFormat } = req.query;

      if (start >= end) {
        // string compare is fine for this
        const error = new Error("The start date must be before the end date.");
        error.code = "HTTP_400";
        throw error;
      }

      // Protection against date range being too large
      const start_date = new Date(new Date(start).setSeconds(0, 0));
      const end_date = new Date(new Date(end).setSeconds(0, 0));
      const difference_in_ms = Math.abs(end_date - start_date);
      let allowed_difference_in_ms = Infinity;

      switch (dateFormat) {
        case "month": {
          allowed_difference_in_ms =
            100 /* days */ * 60 * 60 * 24 * 1000; /* as ms */
          break;
        }
        case "day": {
          allowed_difference_in_ms =
            45 /* days */ * 60 * 60 * 24 * 1000; /* as ms */
          break;
        }
        case "hour": {
          allowed_difference_in_ms =
            48 /* hours */ * 60 * 60 * 1000; /* as ms */
          break;
        }
      }
      if (difference_in_ms > allowed_difference_in_ms) {
        const error = new Error("Requested date range is too large");
        error.code = "HTTP_400";
        throw error;
      }

      // We got this far, so let's get the client and site IDs for the location
      const businessQuery = await db.query(
        `
      SELECT *
      FROM businesses
      WHERE id = $1
    `,
        [authorizedUser.business_id]
      );
      // context.log('Business query:', businessQuery.rows);
      if (businessQuery.rowCount === 0) {
        const error = new Error("Business not found");
        error.code = "HTTP_404";
        throw error;
      }
      if (!businessQuery.rows[0].back_office_client_id) {
        const error = new Error(
          "Business has not been connected to a Back Office account. Contact Sonny's Support to resolve this."
        );
        error.code = "HTTP_404";
        throw error;
      }
      const clientId = businessQuery.rows[0].back_office_client_id;

      const locationQuery = await db.query(
        `
      SELECT *
      FROM locations
      WHERE id = $1
    `,
        [req.query.lid]
      );
      // context.log('Location query:', locationQuery.rows);
      if (locationQuery.rowCount === 0) {
        const error = new Error("Location not found");
        error.code = "HTTP_404";
        throw error;
      }
      if (!locationQuery.rows[0].back_office_site_id) {
        const error = new Error(
          "Location has not been connected to a Back Office account. Contact Sonny's Support to resolve this."
        );
        error.code = "HTTP_404";
        throw error;
      }
      const siteId = locationQuery.rows[0].back_office_site_id;

      const baseUrl = `https://${process.env.SONNYS_SUPPORT_SUBDOMAIN}.sonnyscontrols.com/v1/${clientId}/item-sale-list`;

      const queryParams = []; // just a convention I like to use for readability sake
      queryParams.push(`siteId=${siteId}`);
      queryParams.push(`startDate=${start_date.toISOString().split("T")[0]}`);
      queryParams.push(`endDate=${end_date.toISOString().split("T")[0]}`);
      queryParams.push(`dateFormat=${dateFormat}`);

      const url = `${baseUrl}?${queryParams.join("&")}`;

      context.log(`Making GET request to: ${url}`);
      const backOfficeWashPackagesResponse = await axios
        .get(url, {
          headers: {
            "Sonnys-Support-Api-Key": process.env.SONNYS_SUPPORT_API_KEY,
          },
          httpsAgent: new https.Agent({
            rejectUnauthorized: !(
              process.env?.SONNYS_SUPPORT_ALLOW_SELF_SIGNED_CERT === "true"
            ),
          }),
        })
        .catch(function (e) {
          if (e.response) {
            const error = new Error(
              e.response.statusText || e.response.data.message
            );
            error.code = `HTTP_${e.response.status}`;
            throw error;
          }
        });

      context.log("Successfully received response from the API.");

      const washPackages =
        backOfficeWashPackagesResponse?.data?.data?.washPackages || []; // get the data from where it's expected, or make an empty array

      if (washPackages.length === 0) {
        context.log(
          "No data returned for the given site. But this may be legitimate, so we are allowing the empty array to go out."
        );
      }

      const totalCostPerPackageResults = washPackages.map((washPackage) => {
        const totalSales = washPackage.sales.reduce(
          (acc, sale) => acc + +washPackage.price * +sale.count,
          0
        );
        const totalCount = washPackage.sales.reduce(
          (acc, sale) => acc + +sale.count,
          0
        );
        return {
          id: washPackage.itemId,
          name: washPackage.name,
          price: +(+washPackage.price).toFixed(2),
          sales: washPackage?.sales || [],
          totalSales: +(+totalSales).toFixed(2),
          totalCount,
        };
      });
      context.log(
        "Successfully processed wash packages for calculated total cost per package."
      );
      return {
        body: JSON.stringify({
          totalCostPerPackageResults,
          start: start_date.toISOString().replace(".000Z", "Z"),
          end: end_date.toISOString().replace(".000Z", "Z"),
        }),
      };
    } catch (error) {
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
