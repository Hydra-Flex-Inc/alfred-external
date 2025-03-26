const { app } = require("@azure/functions");
const Common = require("../../../common");
const db = require("../../../db");
const Auth = require("../../../auth");
const Validator = require("../../../validator");
const ErrorHandler = require("../../../errorHandler");

const getWashPackages = async (context, req) => {
  const validator = new Validator(req.req_query, {
    gatewayId: "string|required",
  });

  if (validator.fails()) {
    throw validator.errors;
  }

  const query = `
  SELECT
    cwp.id,
    cwp.name,
    cwp.package_level,
    cwp.color_code,
    cwp.a_la_carte,
    array_agg(cc.id) AS container_ids,
    cwp.back_office_wash_package_id
  FROM car_wash_packages cwp
    LEFT JOIN car_wash_packages_to_chemical_containers cwp2cc
      ON cwp2cc.car_wash_package_id = cwp.id
    LEFT JOIN chemical_containers cc
      ON cc.id = cwp2cc.chemical_container_id
  WHERE
    cwp.iot_hub_device_id = '${req.req_query.gatewayId}'
    AND cwp.deleted_at IS NULL
    AND cwp2cc.deleted_at IS NULL
    AND cc.deleted_at IS NULL
  GROUP BY cwp.id
  `;

  const result = await db.query(query);
  const out = result.rows;

  return out;
};

const createWashPackage = async (context, req) => {
  const body = await req.json();
  const validator = new Validator(body, {
    gatewayId: "string|required",
    washPackageName: "freeflow|required",
    washPackageLevel: "number",
    aLaCarte: "boolean",
    chemicalIds: "array",
    backOfficeWashPackageId: "string",
  });

  if (validator.fails()) {
    throw validator.errors;
  }

  const chemical_ids = body?.chemicalIds?.filter((d) => d) || []; // Remove any nulls

  const packageQuery = `
    INSERT INTO CAR_WASH_PACKAGES(
      iot_hub_device_id,
      name,
      package_level,
      a_la_carte,
      back_office_wash_package_id
    ) VALUES (
      '${body.gatewayId}',
      '${body.washPackageName}',
      '${body.washPackageLevel || 1}',
      '${body.aLaCarte || false}',
      '${body.backOfficeWashPackageId || null}'
    )
    RETURNING id
  `;

  const packageQueryResult = await db.query(packageQuery);
  const packageId = packageQueryResult.rows[0]?.id;

  if (chemical_ids.length) {
    let xrefQuery = `
      INSERT INTO CAR_WASH_PACKAGES_TO_CHEMICAL_CONTAINERS(
        chemical_container_id,
        car_wash_package_id
      ) VALUES(`;
    chemical_ids.forEach((id) => {
      xrefQuery += `'${id}', '${packageId}'),(`;
    });
    // Remove extra comma
    xrefQuery = xrefQuery.substring(0, xrefQuery.length - 2);
    await db.query(xrefQuery);
  }

  return { washPackageId: packageId };
};

const updateWashPackage = async (context, req) => {
  const body = await req.json();
  const validator = new Validator(body, {
    gatewayId: "string|required",
    washPackageId: "uuid|required",
    washPackageName: "freeflow",
    washPackageLevel: "number",
    aLaCarte: "boolean",
    chemicalIds: "array",
    backOfficeWashPackageId: "string",
  });

  if (validator.fails()) {
    throw validator.errors;
  }

  const chemical_ids = body?.chemicalIds?.filter((d) => d) || []; // Remove any nulls

  if (body.washPackageName || body.washPackageLevel) {
    const updatePackageParams = [];
    const updatePackageUpdates = [];
    if (body.washPackageName) {
      updatePackageParams.push(body.washPackageName);
      updatePackageUpdates.push(`name = $${updatePackageParams.length}`);
    }
    if (body.washPackageLevel) {
      updatePackageParams.push(body.washPackageLevel);
      updatePackageUpdates.push(
        `package_level = $${updatePackageParams.length}`
      );
    }
    if (typeof body.aLaCarte === "boolean") {
      updatePackageParams.push(body.aLaCarte);
      updatePackageUpdates.push(`a_la_carte = $${updatePackageParams.length}`);
    }
    if (body.backOfficeWashPackageId) {
      updatePackageParams.push(body.backOfficeWashPackageId);
      updatePackageUpdates.push(
        `back_office_wash_package_id = $${updatePackageParams.length}`
      );
    }

    const updatePackageQuery = `
      UPDATE CAR_WASH_PACKAGES
      SET ${updatePackageUpdates.join(",")}
      WHERE id = '${body.washPackageId}'
    `;

    await db.query(updatePackageQuery, updatePackageParams);
  }

  const currentChemicalQuery = `
    SELECT chemical_container_id
    FROM CAR_WASH_PACKAGES_TO_CHEMICAL_CONTAINERS
    WHERE car_wash_package_id = '${body.washPackageId}'
      AND deleted_at IS NULL
  `;

  const currentChemicalResult = await db.query(currentChemicalQuery);
  const currentChemicals = currentChemicalResult.rows.map(
    (element) => element.chemical_container_id
  );

  if (chemical_ids.length || currentChemicals.length) {
    const chemicalsToDelete = [];
    const chemicalsToAdd = [];
    currentChemicals.forEach((id) => {
      if (!chemical_ids.includes(id)) {
        chemicalsToDelete.push(id);
      }
    });
    chemical_ids.forEach((id) => {
      if (!currentChemicals?.includes(id)) {
        chemicalsToAdd.push(id);
      }
    });

    if (chemicalsToAdd.length) {
      try {
        let xrefQuery = `
          INSERT INTO CAR_WASH_PACKAGES_TO_CHEMICAL_CONTAINERS(
            chemical_container_id,
            car_wash_package_id
          ) VALUES(`;
        chemicalsToAdd.forEach((id) => {
          xrefQuery += `'${id}', '${body.washPackageId}'),(`;
        });
        // Remove extra comma
        xrefQuery = xrefQuery.substring(0, xrefQuery.length - 2);
        await db.query(xrefQuery);
      } catch (err) {
        // Likely primary key issue because the car wash package to container xref already exists, just remove the deleted at
        let undeleteQuery = `
          UPDATE CAR_WASH_PACKAGES_TO_CHEMICAL_CONTAINERS
          SET deleted_at = NULL
          WHERE car_wash_package_id = '${body.washPackageId}'
            AND chemical_container_id IN (`;
        chemicalsToAdd.forEach((id) => {
          undeleteQuery += `'${id}',`;
        });
        undeleteQuery = undeleteQuery.substring(0, undeleteQuery.length - 1);
        undeleteQuery += ")";
        await db.query(undeleteQuery);
      }
    }

    if (chemicalsToDelete.length) {
      let deleteQuery = `
        UPDATE CAR_WASH_PACKAGES_TO_CHEMICAL_CONTAINERS
        SET deleted_at = now()
        WHERE car_wash_package_id = '${body.washPackageId}'
          AND chemical_container_id IN (`;
      chemicalsToDelete.forEach((id) => {
        deleteQuery += `'${id}',`;
      });
      deleteQuery = deleteQuery.substring(0, deleteQuery.length - 1);
      deleteQuery += ")";
      await db.query(deleteQuery);
    }
  }
  return {};
};

const deleteWashPackage = async (context, req) => {
  const body = await req.json();
  const validator = new Validator(body, {
    washPackageId: "uuid|required",
  });

  if (validator.fails()) {
    throw validator.errors;
  }
  const id = body.washPackageId;
  context.log(id);

  const deleteCWP2CC = `
    UPDATE car_wash_packages_to_chemical_containers
    SET deleted_at = now()
    WHERE chemical_container_id = '${id}'
  `;
  const deleteCC = `
    UPDATE car_wash_packages
    SET deleted_at = now()
    WHERE id = '${id}'
  `;
  const resultDeleteCWP2CC = await db.query(deleteCWP2CC);
  context.log(resultDeleteCWP2CC);
  const resultDeleteCC = await db.query(deleteCC);
  context.log(resultDeleteCC);

  return null;
};

const executeFunctionLogic = async (req, context) => {
  try {
    // Simple switch to call the correct handling function for all accepted methods
    let out = null;

    switch (req.method) {
      case "GET":
        out = await getWashPackages(context, req);
        break;

      case "POST":
        out = await createWashPackage(context, req);
        break;

      case "PUT":
        out = await updateWashPackage(context, req);
        break;

      case "DELETE":
        out = await deleteWashPackage(context, req);
        break;

      default:
        // This should not happen as Azure APIM protects against this, but as a failsafe
        // eslint-disable-next-line no-case-declarations
        const error = new Error("Method does not exist");
        error.status = 404;
        throw error;
    }

    return out;
  } catch (error) {
    return ErrorHandler.prepareResponse(context, error);
  }
};

app.http("wash-package", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);
      // Retrieve the authorized user.
      // eslint-disable-next-line no-unused-vars
      await Auth.authorizeUser(req, db, {
        requireBusinessId: true,
      });

      const out = await executeFunctionLogic(req, context);

      return {
        body: JSON.stringify(out),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});

app.http("wash-package-data", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  handler: async (req, context) => {
    try {
      req = Common.parseRequest(req);

      const out = await executeFunctionLogic(req, context);

      return {
        body: JSON.stringify(out),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      return ErrorHandler.prepareResponse(context, error);
    }
  },
});
