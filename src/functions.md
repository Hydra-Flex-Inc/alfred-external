### Functions in question

1. [/adopt-location](): Business and location logic will be handled by Quivio, so this might just turn into a code redemption function.
2. [/back-office-wash-package-list](): Queries from businesses and locations in order to query sonnys support for wash packages
3. [/back-office-wash-package-sales](): Queries from `businesses` and `locations` in order to query sonnys support for wash package sales
4. [/component](): uses user auth to access components. Will need deviceId as a param.
5. [/dashboard-prefs](): Needs user_id to query `dashboard_prefs` table
6. [/location-components](): Uses _location.business_id_ as a param to find a location's components in the `components` table.
7. [/maintenance-events](): Uses _users.id_ and _location.business_id_ as params to find events in the `maintenance_events` table.
8. [/profile-picture](delete): Interacts with auth0 to add or delete a picture. This may not be needed anymore.
9. [/system-alert-block-list](): Uses the _user_id_ to update the `users` table
10. [/system-alert-summary](): Uses _users.id_ and _location.business_id_ as params to find events in the `system_alerts` table.
11. [/user](delete): Queries the `users`, `users_to_businesses`, and `users_to_locations` tables. This may not be needed anymore.
12. [/user-invite](delete): Interacts with `auth0` and queries the `users_to_businesses`, `users_to_locations` tables. This may not be needed anymore.
13. [/user-locations](delete): Queries the `users`, `users_to_businesses`, and `businesses`, `users_to_locations`, and `locations` tables. This may not be needed anymore.
14. [/user-remove](delete): Queries the `users_to_businesses` table. This may not be needed anymore.
15. [/user-update-notification](delete): Queries the `users` table. This may not be needed anymore.
16. [/user-verify-email](delete): Queries `auth0`. This may not be needed anymore.
17. [/users](delete): Queries `auth0` and the `users`, `users_to_businesses`, `businesses`, `users_to_locations`, and `locations` tables. This may not be needed anymore.
18. [/valve-maintenance](): Will need _user_id_ as a param.
19. [/release-notes](delete): Delete?

<style>
[href*="delete"] {
    color: red;
  }
<style>
