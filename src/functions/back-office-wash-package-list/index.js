const { app } = require("@azure/functions");
const axios = require("axios");
const https = require("https");
const Auth = require("../../../auth");
const db = require("../../../db");
const Validator = require("../../../validator");
const ErrorHandler = require("../../../errorHandler");
const Common = require("../../../common");

app.http("back-office-wash-package-list", {
  methods: ["GET"],
  handler: async (req, context) => {
    context.log("Processing request to calculate cost per wash.");
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      const authorizedUser = await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      const validator = new Validator(req.query, {
        lid: "required|uuid",
      });

      if (validator.fails()) {
        throw validator.errors;
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

      // GET WASH PACKAGE LIST FROM BACK OFFICE
      const wash_packages_url = `https://${process.env.SONNYS_SUPPORT_SUBDOMAIN}.sonnyscontrols.com/v1/${clientId}/${siteId}/wash/item-sellable-list`;

      context.log(`Making GET request to: ${wash_packages_url}`);
      const backOfficeWashPackagesResponse = await axios
        .get(wash_packages_url, {
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

      context.log(
        "Successfully received wash packages response from Back Office."
      );

      const washPackages = backOfficeWashPackagesResponse?.data?.data || []; // get the data from where it's expected, or make an empty array

      if (washPackages.length === 0) {
        context.log(
          "No data returned for the given site. But this may be legitimate, so we are allowing the empty array to go out."
        );
      }

      // mark all of these as not being alacarte... they are all potentially real wash packages
      washPackages.forEach((washPackage) => {
        washPackage.a_la_carte = false;
      });

      // GET A LA CARTE (ADDON) LIST FROM BACK OFFICE
      const alacarte_url = `https://${process.env.SONNYS_SUPPORT_SUBDOMAIN}.sonnyscontrols.com/v1/${clientId}/${siteId}/addon/item-sellable-list`;

      context.log(`Making GET request to: ${alacarte_url}`);
      const backOfficeAddonResponse = await axios
        .get(alacarte_url, {
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

      context.log(
        "Successfully received wash packages response from Back Office."
      );

      const addons = backOfficeAddonResponse?.data?.data || []; // get the data from where it's expected, or make an empty array

      if (addons.length === 0) {
        context.log(
          "No data returned for the given site. But this may be legitimate, so we are allowing the empty array to go out."
        );
      }

      // mark all of these as being alacarte
      addons.forEach((addon) => {
        addon.a_la_carte = true;
      });
      return {
        body: JSON.stringify([...washPackages, ...addons]),
      };
    } catch (error) {
      return {
        body: JSON.stringify(ErrorHandler.prepareResponse(context, error)),
      };
    }
  },
});
