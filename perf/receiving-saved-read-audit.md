# Receiving saved-read boundary — source audit

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
