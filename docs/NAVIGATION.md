# Navigation and logo destinations

The app header arrow and in-app browser/system Back go up the screen hierarchy,
not to whichever sibling screen was visited last. Routed screens use explicit
parents; the offline Jobs workspace computes its parent from its current job,
section and material list. Nested drawing/document/room viewers keep their local
parent handlers. The parts wizard uses its logical preceding step; filters from
earlier steps and the pending tray are retained. Empty option stages still skip.

Header override priorities put the routed fallback below the workspace and
nested screens, regardless of React effect mounting order. Browser history guards
claim traversal before Next restores an unrelated route. Closing a guard from the
app never traverses history as a cleanup side effect. At Jobs there is no parent.

Settings > Navigation > Choose destination starts a persistent, account-scoped
picker. Browse normally and use the floating checkmark to capture the current
page with the same snapshot registry/format used by drawing hyperlinks. Cancel
leaves the previous destination unchanged. Selection survives page loads in the
same tab. The saved destination is scoped to the account in localStorage on this
device; it is not a company-wide or cross-device preference. The logo restores
the saved nested view even when already on that route. Reset restores the account's
invite default, or Jobs when there is no invite default.

Migration 0076 adds nullable defaultLandingPage JSON columns to users and invites.
Joining through an invite copies its valid internal default to the user if no
account default exists, and redirects to that destination. This does not grant
additional permissions. Existing account defaults are preserved. On 2026-10-16,
only Tim's active Journeyman invite was configured with Alma Phase #2 as its
default; all 11 current members of Tim's organization were subsequently assigned the Alma default at his explicit request. Their permissions were not changed.

Validation: focused unit/component/workflow tests, route tests for invite defaults
and rejected external destinations, and repeated history traversal in Chromium.
Physical Android gesture behavior remains a device verification step.
