### Functions in question

1. [/adopt-location](): Business and location logic will be handled by Quivio, so this might just turn into a code redemption function.
2. [/component](done): uses user auth to access components. Will need deviceId as a param. Need to identify what is needed from auth0
3. [/location-components](done): Uses _location.business_id_ as a param to find a location's components in the `components` table.
4. [/maintenance-events](done): Uses _users.id_ and _location.business_id_ as params to find events in the `maintenance_events` table. This will probably evolve to use only gateway_id or iot_hub_device_id (also possibly location_id)
5. [/system-alert-summary](done): Uses _users.id_ and _location.business_id_ as params to find events in the `system_alerts` table. This will probably evolve to use only gateway_id or iot_hub_device_id (also possibly location_id)
6. [/valve-maintenance](done): Will need _user_id_ as a param. This will probably evolve to use only gateway_id or iot_hub_device_id (also possibly location_id)

<style>
[href*="delete"] {
    color: red;
  }
[href*="done"] {
    color: green;
  }
[href*="functionUpdated"] {
    color: yellow;
  }
<style>
