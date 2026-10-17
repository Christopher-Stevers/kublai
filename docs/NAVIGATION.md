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

## Android cold-launch Back — 2026-10-17

Android's browser UI may skip synthetic history entries created before user
activation, or re-created following a history traversal. A `history.back()` test
alone does not reproduce that policy, so a guard could appear to pass browser
checks while an installed app still closed from its landing screen.

On Android with `CloseWatcher` support, one shared native close watcher now calls
the same highest-priority parent handler as the header arrow. It re-arms after
React applies the parent screen. Registering separate watchers for each nested
screen would risk processing multiple levels on one close request, so watcher
ownership stays in the central override registry. The Jobs root registers no
nonexistent routed parent, allowing ordinary platform closing there.

Other platforms and unsupported/failed native constructors retain the history
fallback. A marker inherited from an earlier document is cleared before adding
its sentinel; Next and workspace metadata remain intact.

Verification includes 98 focused tests and actual Chromium native close requests
from a fresh Android-user-agent context, without a tap or user activation. The
browser fixture reads state through CDP with `userGesture: false` (ordinary
Playwright evaluation can grant activation and hide the bug). Four consecutive
native close requests traversed Drawing → Set → Drawings → Job → Jobs, with zero
new history entries or client errors. Alternating the arrow and native requests
also moved exactly one level. Escape exercises the browser close-request path;
a physical Android edge swipe remains a device verification step.

Sources: [Chromium history intervention](https://chromium.googlesource.com/chromium/src/+/main/docs/history_manipulation_intervention.md),
[Chrome's Android close requests](https://developer.chrome.com/blog/new-in-chrome-126),
[CloseWatcher specification](https://html.spec.whatwg.org/dev/interaction.html#the-closewatcher-interface).
