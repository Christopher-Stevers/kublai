# Immediate writes — phase 1 progress

Implemented on 2026-11-10; prepared source, not activated in the bootstrap release.

`useInstantMutation` applies a cache edit in the initiating call, sends the
request once, and restores a refused edit with the existing quiet notice. It
uses `networkMode: always` and no retries: offline writes fail immediately and
are not replayed on reconnect. Existing durable Replicache writes stay on their
own engine.

`beginInstantQueryUpdate` holds a short-lived lock for the edited query. Another
edit to that query is refused while the first request is pending, rather than
put in a second queue. Other queries remain editable. Rollback and reconciliation
check the query instance and optimistic value: a newer server refresh wins, and
an account wipe cannot be undone by a late request. Authoritative invalidation
follows settled network requests, not preparation failures.

## Applied actions

| Action | Seven-day observed calls | Behavior |
| --- | ---: | --- |
| `catalogue.hideParts` | 117 | Preview the same hide rules as the server; reconcile final rule ids; roll back a refusal. Existing confirmation and release-click behavior remain. |
| `catalogue.showHiddenParts` | 2 | Preview removing a rule or restoring a selection, preserving hidden siblings. |
| `materialList.updateOrderNotes` | 1 | Update cached notes and close the editor immediately; retain text for retry if the server refuses. |
| `materialList.updateOrderItemVerification` | 76 | Keep the existing immediate receipt controls, show a pending save, restore a refused edit and hold accepted values until the existing sync refresh arrives. |

Counts come from `observed-trpc-usage.json`, which is instrumented server journal
traffic, possibly including QA. The first entry was conservatively marked bulk
by the inventory script; source review established that it hides catalogue
choices, does not delete parts, and preserves existing confirmation controls.

This is **4 of the 20 observed tRPC actions**, not completion of the 20-write
step. Material quantities already use Replicache. Drawing edits already have an
independent queued-edits path, so they must be audited before any replacement.
Super Label results require actual recognition; pending feedback can be instant,
but a predicted label cannot be presented as a completed result. Sending an
order and recording a receipt must distinguish pending intent from authoritative
completion. The remaining actions still need their own reconciliation review.

A read-only aggregate of the two legacy sync-receipt tables found no entries in
the same seven-day window (`observed-sync-write-usage.json`). This does not prove
that no Replicache writes occurred and cannot rank those writes. Do not invent
usage counts to fill the list.

Receipt previews live only in the screen's memory. They neither edit Replicache
receipt rows nor queue offline writes. A newer saved receipt supersedes the
preview, even if the write's HTTP response arrives later. Another edit to the
same pending receipt is refused; other receipts remain editable. A reset version
also restores the card/table control when the connection dropped before the
optimistic transaction could start. Without that reset, unchanged saved props
could leave the refused quantity displayed. This is a tier-one repair, not the
phase-two receiving sync domain or a convergence claim.

## Verification and remaining gate

Focused tests cover synchronous cache changes, accepted normalization, permission
failure, concurrent edit refusal, authoritative refreshes, sign-out/account cache
wipes, offline rejection/no reconnect replay, and a connection lost between the
gesture and send. Catalogue UI regression tests and shared hide-rule tests pass.

These establish behavior, not a phone-frame timing result. The app benchmark,
reference Pixel timing and the plan's no-regression gate are still required
before this broader change is activated.

Receipt bulk ordering follow-up (verified after explicit release of the baseline
quiet window): table stepper debounce and the grid's delayed single click register
an ephemeral intent synchronously, before the mutation begins. Bulk all/none
controls include those intents in their disabled state and use the same synchronous
guard at dispatch, including the in-flight individual request and bulk request.
The intent remains registered through the microtask handoff to the request. Table
queued intents flush exactly once on removal; grid delayed single clicks retain
their existing cancellation-on-removal behavior; a double click replaces the
pending grid single-click action. New table, card and picker intents consult the
latest read-only state and a synchronous bulk gate callback, without discarding an
already-authorized queued send. Callback identities include the durable order
line so a delayed intent cannot switch to a different order when a material row's
latest order changes. Card completion/problem callbacks run outside functional React state updaters,
so updater replay cannot duplicate a write. This is short-lived UI ordering, not
a second offline queue.

Bulk receipt dispatch also checks connectivity synchronously and uses
`networkMode: "always"` with retries disabled. It cannot pause and replay on
reconnect. Confirmed bulk writes schedule refresh without awaiting a paused
refetch, so the ordering lock does not depend on connectivity after acceptance.
No bulk credited quantity is fabricated. The final combined owned run passed
101 tests across 10 files with one Vitest worker; it includes deferred individual
requests, debounce-to-request handoff, unmount policy, same-turn reverse bulk
locking, offline rejection, and StrictMode dispatch-once assertions. Production
ESLint returned no errors (three existing drawing-view warnings). Whole-source
TypeScript remains blocked by existing repository test typing errors; no changed
production path reported an error. No release or phone-timing gate is claimed.
