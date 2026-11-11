# Saved order summary — prepared outside R19

Prepared outside frozen R19. After explicit quiet release, final focused checks
passed 103 tests across 11 files with one worker. Scoped lint adds no findings;
root’s coordinated scoped runtime TypeScript check also passed. No build, application,
browser, real database or activation ran. No frozen R19/f9 or dirty PackingSlips,
schema, worker, zoom or tsconfig file was changed.

## Read boundary

MaterialListScreen's verification and notes observers use one typed hook backed by
TanStack useQuery and the existing exact `{orderId}` tRPC query key. Both capture
account + protected order-key authority before the real RPC. When the IDs match,
only verification reads; notes aliases its raw data/loading. Distinct notes stays
saveReading:false, captures/revokes the key but never creates a saved projection. The optional server
expectedAccountKey compares the existing liveAccountScope before DB work; omission
remains compatible, the field is stripped, and its length is 1–512. The server
additively returns actual orders.jobId. Notes-only reads ignore irrelevant job
metadata changes. Verification waits for headerReady, not a nonnull job: loaded
unassigned lists still read live, with no saved projection. A genuine loaded job
reassignment cancels/refetches that read once, without changing the key or adding
a retry loop. Existing notes optimistic updates/invalidation keep the same key.

The query function, not QueryCache success/hydration/manual data, owns the real
HTTP response. Registration/quota failure first tries an account-validated readonly capture of
an existing key epoch; that fallback never registers or mints authority. No key
means uncached live reading. If storage cannot be opened/read at all, live reading
still works and saved display/persistence is suppressed for that hook. After HTTP, a guarded read validates persisted epochs;
its saved return value is discarded. Known tagged authority AbortError suppresses
late HTTP publication; ordinary storage failure disables persistence without
turning accepted server data into permission loss. Before every publish/save the
actor/account/store, request sequence, view/Activity lifecycle and denial generation
must still match. A→B→A cannot reuse an old owner object. The store's final put and
namespace eviction separately recheck captured lifecycle and the caller's view gate.

Both notes-only and verification requests protect the same key on terminal denial.
A nonaborted, current-sequence order 404/410 hides its saved summary and
atomically revokes only that captured key;
it does not stop device caches or gate unrelated views. The exact endpoint's
401/403/SIGNED_OUT handling reuses global identity denial: current server 403 comes
from hasAppAccess's organization/approval checks, not a per-order permission rule.
Old request-start device authority cannot revoke a newer actor. A canceled or
superseded resource denial does not revoke a newer notes/verifier reading. Changes to that
server 403 contract would require review. No arbitrary mutation is classified as a
read, and the full raw order response is never allowlisted for device persistence.
If storage is unavailable or a captured-token revoke itself fails, current UI is
hidden but durable deletion cannot be guaranteed, including after reload. No
unfenced late revoke, localStorage queue or claimed storage-loss revocation proof
is introduced. The existing-key readonly path specifically covers recoverable
registration/quota failure while authority remains readable.

## Projection and UI

Only real matching order/list/job response identities can create a projection.
Missing server job identity allows legacy live reading but never manufactures a
saved binding from Replicache. The projection contains actual order/line IDs,
order number, supplier display name, descriptions/SKUs, previous ordered quantities,
a local cache timestamp and line counts. No contacts, notes drafts, permissions,
order/receipt status, received/credited quantities or verification flags are copied.

The separate plain SavedOrderReading section has no controls. It shows 'Saved
order', local saved date and historical lines. 'Refreshing…' reflects actual query
isFetching only; offline/error states say saved details/current data unavailable.
It never populates verifyOrder, notesOrder, receipt previews, row filtering,
DeliveryTracker, upload or editing permissions. Real live data replaces it. Local
optimistic notes can still affect the raw memory query but cannot create a saved
projection. This is partial readable content, not a current receiving approval.

## Bounded serialized payload

Central constants retain a total 20 MiB serialized Tier1 payload allowance:
256 KiB reserved for this protected receiving namespace, remainder for the existing
query payload. Browser/IndexedDB metadata overhead is not claimed within that cap;
existing drawing binary/custom snapshot budgets remain distinct and unchanged.
Older query records above the reduced query slice may be discarded by the existing
restore size check; this is optional-cache loss, not account revocation.

Each receiving projection is ≤16 KiB and contains at most 32 lines. Truncated line
counts are explicit ('Showing 32 of 40 saved lines'); individual text is not silently
cut. Oversize projection is not cached. The same authority+snapshot transaction
prunes only oldest saved rows in this namespace before put, keeping its serialized
payload≤256 KiB. Other protected/ordinary snapshots are untouched. Eviction is cache
management, not a permission denial or per-entity revision ordering mechanism.

## Focused proof and remaining limits

Deferred tests cover immediate labelled saved paint while real RPC waits, accepted
replacement and excluded fields; transport error vs scoped missing-order denial;
cache-capture failure fallback; independently bound context revocation without
storage events before pending HTTP resolves; notes404 before verification returns;
A→B→A; no persistence from manual query data; pending header versus loaded-unassigned;
notes-only metadata arrival; genuine job reassignment; payload/line/budget limits;
and lifecycle disposal at the budget cursor before eviction/put. Server cases
check actor/org/simulation mismatch before DB, matching/legacy omission, real job
return, app-access refusal and input bound. Existing screen/store/query-cache
regressions ran after quiet release. The exact command, 16 owned source/test
paths, hashes and original log identities are in the [proof artifact](artifacts/receiving-saved-order-focused-2026-11-11.json).

Initial run: 88 passed, two JobsClient Activity tests failed because my earlier
badge slice had not updated their mocked endpoint metadata/provider. The test-only
fix adds a real QueryClient wrapper, matching endpoint _def and coherent offline
getter; existing retention/draft/editor assertions are unchanged. The corrected
90-test set passed; after final authority/CONFLICT regressions and existing receipt/
notes suites were included, all 103 passed. Original failure log remains preserved.

Final 16-file lint reports only inherited materialList router 153 errors/one warning
and Activity fixture two errors. Linting HEAD source reproduces the exact rule,
message, column and source line for every finding. All new source/test files and
other changed files are clean. The first lint pass's new callback/dependency,
fixture-observation and typed-IDB issues were corrected and the final tests rerun.
No production rule was suppressed; one test-only unbound-method exception documents
forwarding the original fake-IDB method with apply(this,args). Node deprecation and
two jsdom scrollTo notices remain. Root’s coordinated check exited 0 with an empty log:
`timeout 180s pnpm exec tsc --noEmit --incremental false --pretty false --project /tmp/foremanhq-receiving-notification-types-20261111.json`.
It includes 11 explicit receiving/notification runtime roots plus next-env/src
declarations and import closure. Log:
`/tmp/foremanhq-receiving-notification-types-attempt1.log`. This is current-source
scoped TypeScript, not a canonical production build or all-test typecheck.

Own-flight cancellation checks exact Query object and its current public retryer
promise before canceling, so old completion cannot cancel a newer notes request.
The installed TanStack implementation assigns that retryer before invoking the
query function; no private field or synthetic attempt marker is changed.

The primitive cannot erase a read painted before a missed cross-tab notification.
Saved UI therefore drops its prior projection on lifecycle cleanup/resume, reloads
under persisted tokens and suppresses matching denial hints. Two independently
authorized snapshots in one epoch are not globally server-revision ordered; local
request/view guards and the explicit historical label remain essential. No browser
latency, cross-tab instantaneous presentation, all-screen coverage or activation is
claimed. Receiving remains prepared until final proof/review.


Owned fixture changes: JobsClient.tools adds only endpoint _def so the real hook can
form its key while disabled; no broad receiving mock replaces behavior. The
Activity fixture correction addresses the earlier badge dependency, not a runtime
receiving fix. Existing assertions remain intact in both files. Ordinary snapshot
and unrelated protected namespaces retain their behavior. Storage-loss durability,
already-painted missed-event data and independent-tab server revision ordering
remain the explicit limits above.
