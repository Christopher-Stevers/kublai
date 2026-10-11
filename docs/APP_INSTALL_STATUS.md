# App installation and install-button observations

Organization → Members shows an app-status summary; selecting a member shows each reported browser profile, latest mode, install-button visibility and server-recorded times. Reading reports requires Organization and member-management permissions and is scoped to the viewer's current organization.

The shared header reports for approved, authenticated users on visible online visits, when installation state changes, on returning to the page, and every 15 minutes while visible. A stable random UUID is stored in browser local storage. No hardware fingerprint, full user-agent string, location, notification endpoint or browsing history is collected. Employee simulation and the tutorial do not submit reports.

Opening standalone PWA mode records installed-app evidence. Later browser visits retain the last installed-app observation, but update current mode and button visibility. A browser visit alone is not proof of being uninstalled. The install-button flag checks whether the actual shared-header button intersects the viewport; it does not claim the person read it. Old observations can be stale, and browser profiles are not physical device identifiers. Storage clearing/private browsing can create extra profiles. Notification registration remains a separate signal.

Repeated identical reports are throttled to one database update per two minutes, with up to 32 profiles per account. Mode/button changes update immediately. Reporting errors never block normal work. No external analytics or paid service is used. Deleted users' observations cascade away.

Apply `scripts/ops/apply-app-device-migration.mjs` before deploying the code. Migration 0063 creates an additive table and records itself atomically. Previously installed users remain Unknown until they next open ForemanHQ online; no installation history is fabricated.
