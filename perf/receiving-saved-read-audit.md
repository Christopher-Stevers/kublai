# Receiving saved-read boundary — source audit

The original hold below was superseded by the approved existing-store primitive
`9ace848a` and the [bounded receiving follow-up](receiving-saved-order.md). The
audit remains as the reason for scoped generation fencing, not a current claim
that the store lacks that API. No second persistence/sync engine was introduced.

Source-only during the R18 timing quiet window. No implementation, runtime,
benchmark, database or test was run. Frozen R18 and dirty receiving files are
unchanged. This is a proposed partial Tier1 read, not acceptance or permission to
turn saved receipt state into current authority.

## Actual readers and boundaries

`MaterialListScreen.tsx:176–184` is the only UI caller of
`materialList.getOrderById`: verification and notes observers share the same
`{orderId}` query. They run online only. List/items already come from Replicache.
The query is absent from both device persistence and authority-read classification
in `device-query-cache.ts`; normal in-memory query retention is distinct from a
saved reading surviving reload. Account transitions clear the shared query client,
and DrawingAccountProvider validates its account/store binding; those mechanisms
do not by themselves give this unclassified endpoint a durable denial fence.

`materialList.ts:1931–2042` requires `hasAppAccess` (effective signed-in user,
organization and approved access) and filters the order by organization. It does
not require `orders.receive` or perform a separate job/folder assertion. Its raw
response includes supplier contacts/email, notes, status, order/material-list IDs,
net quantity after credits, original/credited quantities, received quantities and
verification statuses. It is unsuitable for blind allowlisting. The client uses
these rows to match/filter visible parts, initialize receipt previews and populate
bulk controls; a saved response cannot simply replace `verifyOrder` without also
feeding those write/scoping paths. `canReceive` separately comes from getMyRole,
and mutations still enforce server permissions, but that is insufficient proof
that a stale displayed receipt/credit total is current approval.

`PackingSlips.tsx:91–146` uses imperative no-store GET
`/api/job-documents/packing-slips`, with abort cleanup on close/identity inputs.
Opening online clears slips, orderItems and canUpload before reading. Offline UI
currently says reconnect. It is outside TanStack/device-query persistence and its
plain-fetch denial does not enter the tRPC read-authority hook.

The route validates job/list/order IDs and request identity, calls
`assertDocumentAccess`, and responds `private, no-store`. `packingSlipDocuments`
filters the authorized job/org and folder role, returning document/version/link,
analysis and receiving-review status. `liveOrderItems` additionally requires
`orders.receive` and matches order job/org. The returned `canUpload` is live
capability; order items drive DeliveryTracker. Persisting that entire response
would mix folder access, capability and current receipt/analysis approval. Neither
cached canUpload nor saved applied/complete status may enable upload, analysis,
resolve, confirm or indicate a currently reconciled receipt.

## Smallest justified proposal

A bounded **order reading projection for the already visited verification route**
is feasible in Phase1; it is not a second sync engine or Phase2 write queue.
Defer PackingSlips caching and full raw-query persistence.

Use a separate typed saved-reading value, never assign it to `verifyOrder`,
`notesOrder`, receipt snapshots or role state. Project only exact order/list IDs,
order number, supplier display name, and ordered-line IDs/descriptions/SKUs/net
ordered quantities from a successful authoritative read. Exclude supplier
contacts, capability, status/verification, credited/received totals, pending
previews and notes drafts. Display it as a visibly saved, read-only reading while
the current order request is pending/unavailable. It may show the order header
and an isolated noninteractive parts summary; it must not filter the editable
Replicache list or populate receipt controls. Fresh live data replaces it; the
existing remote order response alone supplies current quantities/receipt state.
This is limited visible value, not complete receiving readiness.

Admission requires the validated account/store, selected order and material-list
identity, current Replicache job identity and an actual nonmanual HTTP success.
Only the selected visited order is read; no unopened-order prefetch. Use the
existing account-persisted generation fence, captured request-start authority and
existing snapshot storage, rather than inventing another database/queue. Actual
request-start binding must also fence late responses and A→B→A transitions.
Successful local optimistic note updates are not an authoritative-save certificate.

A prerequisite source review must approve exact `getOrderById` terminal-denial
integration with the existing read-authority/purge mechanism: today it is not
classified. After a known 401/403/404/410, hide the saved reading synchronously and
prevent delayed disk/HTTP writes restoring it. This does not grant any new read
or write capability. Do not implement persistence while that prerequisite is
missing, or broadly add receiving endpoints to the allowlist. A missing current
order cannot be inferred to be approved, deleted or reconciled from saved rows.

## Focused proof required before adoption

Use real QueryClient + account provider + IndexedDB authority tests with deferred
network/disk work: same-account selected-order saved paint before HTTP, exact
order/list/job isolation, success replacement, transient failure retaining only
the labelled reading, and no write/control/DeliveryTracker input from it. Verify
cache miss keeps the existing loading path and offline never sends/replays writes.
Hold old disk/response until after terminal denial and after account replacement;
neither may resurrect the reading, including reconnect/reload/another store
context. Assert cached capabilities/contact/receipt/credit fields are absent and
not persisted, optimistic previews never reach disk, and latest authoritative
receipt/credit changes win when the read arrives. Existing receipt-intent ordering
and accepted-write reconciliation must remain untouched.

The current tests prove individual receipt optimism/rollback and packing-slip
UI/network workflows; they do not establish this new projection's durable denial
or read-only behavior. No test count or runtime timing is claimed by this audit.

## Per-order denial prerequisite — persistence held

Follow-up source review found an existing request-start hook already captures
`captureDeviceReadAuthority()` in `trpc/react.tsx:150–157` before `next(op)`.
It handles imperative and observed tRPC requests; adding a duplicate request engine
is unnecessary. However getOrderById is not an authority-classified read. Merely
adding it would route order NOT_FOUND through the current default account-wide
snapshot purge/reload gate. A deleted order must not revoke unrelated app/drawing
reads, so that change is not proposed. Identity-level 401/403 handling requires
separate semantic review; no global policy was broadened.

The current DrawingOfflineStore API cannot safely implement a narrow order404
fence: `saveSnapshot` (590–610) blindly writes after account-generation validation;
`readSnapshot` (612–615) checks only that account authority. The atomic transaction
checks (310–336) and clear (617 onward) are account-wide. There is no public
per-snapshot generation/delete/revoke/CAS operation.

Concrete counterexample: same-account tab A has an old HTTP response or pending
snapshot write; tab B records a deleted-order tombstone using saveSnapshot.
Account authority has intentionally not changed. A's late save still passes the
account epoch check and overwrites that tombstone. A second snapshot key,
local-state canceled flag or storage-event notification cannot atomically reject
that writer after missed events/reload. Existing A→B→A account disposal/generation
fences remain useful but do not solve this same-account per-order race.

A correct later design needs an atomic account **and per-order** generation token,
captured before the request, checked in the same IDB transaction as projection
write/read, and advanced with deletion on terminal order denial. Active readers
must also hide the matching saved summary without gating unrelated UI; late
requests/old contexts cannot clear a newer tombstone or recover it without a new
authoritative read. Existing storage offers no such scoped operation. Implementing
it now would create a new revocation mechanism even if it reused an object store.
Under the current bounded Tier1 scope, **hold receiving persistence**, rather
than add a parallel cache engine or silently reuse account-wide revocation.
No runtime changes or new tests were made for this follow-up. The prior proposed
projection and deferred cross-tab/account/disk tests remain a design prerequisite,
not an implementation or durable-revocation proof.
