/* eslint-disable space-before-function-paren */
const Validator = require("./validator");
const cookie = require("cookie");

module.exports = {
  /**
   * This function determines the validity of the Auth cookie in the header
   *
   * It returns identity information about the Authorize user it finds.
   *
   * If there are any issues with the Auth token, this function throws a 401 error.
   *
   * @param {*} req The HTTP request.
   * @param {*} db The database client. Included as an arg so that we can make use of the same pool instance.
   * @param {*} options requireBusinessId, requireAdminRole supported
   */
  async authorizeUser(req, db, options = {}) {
    // Parse & Validate the Auth cookie.
    const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};

    const validator = new Validator(cookies, {
      HFI_ALFRED_AUTH_TOKEN: "required|uuid",
    });

    if (validator.fails()) {
      // The Auth Token cookie was not present, or was not a UUID.
      const error = new Error("Unauthorized");
      error.code = "HTTP_401";
      throw error;
    }

    // Retrieve user identity & permissions for internal use.
    const params = [cookies.HFI_ALFRED_AUTH_TOKEN];
    const predicates = [
      "users.auth_token = $1",
      "users.deleted_at IS NULL",
      "businesses.deleted_at IS NULL",
    ];

    const query = `
      SELECT 
        users.id as user_id,
        users.auth0_id,
        businesses.id as business_id,
        businesses.name as business_name,
        u2b.role_type
      FROM users
      LEFT JOIN users_to_businesses u2b ON users.id = u2b.user_id
      LEFT JOIN businesses ON u2b.business_id = businesses.id
      WHERE ${predicates.join(" AND ")}
    `;
    const result = await db.query(query, params);
    let authorizedUser;
    if (result.rowCount > 0) {
      authorizedUser = result.rows.shift();
    } else {
      // Couldn't find a user with this Auth code.
      const error = new Error("Unauthorized");
      error.code = "HTTP_401";
      throw error;
    }

    // If business ID is required, but not present on authorized user, throw a 403
    if (options.requireBusinessId && !authorizedUser.business_id) {
      const error = new Error("Forbidden");
      error.code = "HTTP_403";
      throw error;
    }

    // If user belongs to a business but is not an admin, and admin is required, throw a 403.
    // Note - this allows users that are NOT attached to a business. Combine with requireBusinessId to weed out unattached users.
    if (
      options.requireAdminRole &&
      authorizedUser.business_id &&
      authorizedUser.role_type !== "admin"
    ) {
      const error = new Error("Forbidden");
      error.code = "HTTP_403";
      throw error;
    }

    return authorizedUser;
  },

  /**
   * Ensure that the authorized user is allowed to see this Location
   *
   * @param {*} locationId The location id to check.
   * @param {*} authorizedUser An authorized user, as returned by Auth.authorizeUser()
   * @param {*} db The database client. Included as an arg so that we can make use of the same pool instance.
   * @returns The business ID that this location belongs too.
   */
  async canAccessLocation(locationId, authorizedUser, db) {
    const query = `
      SELECT business_id
      FROM locations
      WHERE id = $1 
        AND business_id = $2 
        AND deleted_at IS NULL
    `;
    const result = await db.query(query, [
      locationId,
      authorizedUser.business_id,
    ]);

    if (result.rowCount === 0) {
      const error = new Error("Forbidden");
      error.code = "HTTP_403";
      throw error;
    } else {
      return result.rows.shift().business_id;
    }
  },

  /**
   * Ensure that the authorized user is allowed to see this IOT Device (gateway).
   *
   * This is accomplished by determining which location a device belongs too,
   * and then whether the authorized user has access to that location.
   *
   * @param {*} deviceId The iot_hub_device_id of the IOT Device (gateway)
   * @param {*} authorizedUser An authorized user, as returned by Auth.authorizeUser()
   * @param {*} db The database client. Included as an arg so that we can make use of the same pool instance.
   * @returns The location ID that this device belongs to.
   */
  async canAccessDevice(deviceId, authorizedUser, db) {
    const query = `
      SELECT l.id as location_id
      FROM locations l
      LEFT JOIN gateways g ON l.id = g.location_id
      WHERE g.iot_hub_device_id = $1 
        AND l.business_id = $2
        AND l.deleted_at IS NULL
        AND g.deleted_at IS NULL
    `;
    const result = await db.query(query, [
      deviceId,
      authorizedUser.business_id,
    ]);

    if (result.rowCount === 0) {
      const error = new Error("Forbidden");
      error.code = "HTTP_403";
      throw error;
    } else {
      return result.rows.shift().location_id;
    }
  },

  /**
   * Ensure that the authorized user is allowed to see this component.
   *
   * This is accomplished by determining which location a component belongs too,
   * and then whether the authorized user has access to that location.
   *
   * @param {*} componentId
   * @param {*} authorizedUser
   * @param {*} db
   * @returns The IOT hub device ID that this component belongs to.
   */
  async canAccessComponent(componentId, authorizedUser, db) {
    const query = `
      SELECT c.id, g.iot_hub_device_id
      FROM
        locations l
        LEFT JOIN gateways g ON l.id = g.location_id
        LEFT JOIN components c ON g.iot_hub_device_id = c.iot_hub_device_id
      WHERE c.id = $1 
        AND l.business_id = $2
        AND l.deleted_at IS NULL
        AND g.deleted_at IS NULL
        AND c.deleted_at IS NULL
    `;

    const result = await db.query(query, [
      componentId,
      authorizedUser.business_id,
    ]);

    if (result.rowCount === 0) {
      const error = new Error("Forbidden");
      error.code = "HTTP_403";
      throw error;
    } else {
      return result.rows.shift().iot_hub_device_id;
    }
  },

  /**
   * Ensure that the authorized user is allowed to see this user.
   *
   * This is accomplished by determining which business a component belongs too,
   * and whether the authorized user has administrator access within that business.
   *
   * @param {*} userId
   * @param {*} authorizedUser
   * @param {*} db
   * @returns data from the users table for the requested userId.
   */
  async canAccessUser(userId, authorizedUser, db) {
    // Authorized user must be of type 'admin' in order to see a user that isn't themself.
    if (
      authorizedUser.role_type !== "admin" &&
      authorizedUser.user_id !== userId
    ) {
      const error = new Error("Forbidden");
      error.code = "HTTP_403";
      throw error;
    }

    const query = `
      SELECT u.*, b.id as business_id
      FROM
        users u
        JOIN users_to_businesses u2b
          ON u.id = u2b.user_id
        JOIN businesses b
          ON u2b.business_id = b.id
      WHERE u.id = $1
        AND u.deleted_at IS NULL
        AND b.id = $2 
        AND b.deleted_at IS NULL
    `;

    const result = await db.query(query, [userId, authorizedUser.business_id]);

    if (result.rowCount === 0) {
      const error = new Error("Forbidden");
      error.code = "HTTP_403";
      throw error;
    } else {
      return result.rows.shift();
    }
  },

  /**
   * Ensure that the authorized user is allowed to see this business.
   *
   * This is accomplished by determining if the authorized user has administrator access for that business.
   *
   * @param {*} businessId
   * @param {*} authorizedUser
   * @returns true
   */
  async canAccessBusiness(businessId, authorizedUser) {
    // The user must be an admin of the requested business.
    if (
      authorizedUser.role_type !== "admin" ||
      authorizedUser.business_id !== businessId
    ) {
      const error = new Error("Forbidden");
      error.code = "HTTP_403";
      throw error;
    }

    return true;
  },
};
