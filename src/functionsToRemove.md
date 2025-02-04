### Functions to delete

1. [/back-office-wash-package-list](): Queries from businesses and locations in order to query sonnys support for wash packages
2. [/back-office-wash-package-sales](): Queries from `businesses` and `locations` in order to query sonnys support for wash package sales
3. [/dashboard-prefs](): Needs user_id to query `dashboard_prefs` table
4. [/profile-picture](delete): Interacts with auth0 to add or delete a picture. This may not be needed anymore.
5. [/user](delete): Queries the `users`, `users_to_businesses`, and `users_to_locations` tables. This may not be needed anymore.
6. [/user-invite](delete): Interacts with `auth0` and queries the `users_to_businesses`, `users_to_locations` tables. This may not be needed anymore.
7. [/user-locations](delete): Queries the `users`, `users_to_businesses`, and `businesses`, `users_to_locations`, and `locations` tables. This may not be needed anymore.
8. [/user-remove](delete): Queries the `users_to_businesses` table. This may not be needed anymore.
9. [/user-update-notification](delete): Queries the `users` table. This may not be needed anymore.
10. [/system-alert-block-list](): Uses the _user_id_ to update the `users` table
11. [/user-verify-email](delete): Queries `auth0`. This may not be needed anymore.
12. [/users](delete): Queries `auth0` and the `users`, `users_to_businesses`, `businesses`, `users_to_locations`, and `locations` tables. This may not be needed anymore.
13. [/release-notes](delete)

<style>
[href*="delete"] {
    color: red;
  }
<style>
