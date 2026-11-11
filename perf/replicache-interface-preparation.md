# Existing mutator interface preparation

Source-only preparation for SPEED_PLAN §8 step 4, following
[the existing contract](replicache-existing-contract.md) and
[the isolated contract check](replicache-isolated-check.md). No implementation,
test, runtime, schema or worker change is authorized by this note. Frozen R18
and its held guarded activation/edge workflow remain unchanged. New domains,
partial sync and convergence proofs are separate later steps.

## Current 13-write map

Device implementations are the named methods returned by
`src/lib/replicache-material-list.ts:172` (`MaterialListReplicacheMutators` types
at line 16). Server counterparts are cases in
`src/server/replicache/material-list-sync.ts:431`. Its input schemas are at
95–216 and permission map at 70–85. Names below are existing persisted wire
names and must not change during a behavior-preserving extraction.

| Wire name | Device view effect | Server counterpart / permission | Behavior to retain |
| --- | --- | --- | --- |
| `renameMaterialList` | Update existing list name + pendingSync | case 444 / lists.edit | Missing local row is a no-op; server validates owned list and emits existing list hint. |
| `updateItemQuantity` | Existing unsent item's string quantity, pack-aware total + pendingSync | case 462 / lists.edit | Positive numeric set operation; server price/room/list authority and sent lock remain. Not an additive quantity merge. |
| `removeItem` | Delete unsent item + local pending tombstone | case 517 / lists.edit | Sent lock, authoritative deletion/totals/tombstone/notification behavior. |
| `addItem` | Device-ID row with display snapshots, room inheritance, total + pendingSync | case 561 / lists.edit | Server resolves actual parts/defaults/prices/room; device snapshot is not authority. |
| `updateItemSupplierPart` | Existing unsent item's supplier/price snapshot + pendingSync | case 632 / lists.edit | Nullable supplier choices, offline supplier-part ID resolution, selected/default price rules and sent lock. |
| `createJob` | Device-ID draft job + pendingSync | case 719 / jobs.create | Existing UUID, defaults, location and insert behavior. |
| `updateJob` | Partial fields on existing job + pendingSync | case 734 / jobs.edit | Missing versus explicit null; supplier-default validation remains server-owned. |
| `deleteJob` | Delete job and its cached lists/items | case 762 / jobs.delete | Existing server cascading cleanup and org predicates; no invented delete-wins conflict rule. |
| `createMaterialList` | Device-ID list, room/kind/default fields + pendingSync | case 803 / lists.edit | Server job/room access, quote creation, tools behavior and canonical naming. |
| `deleteMaterialList` | Delete cached list and its items | case 876 / lists.delete | Existing quote/item deletion and tombstone even for an already-missing list. |
| `createSupplier` | Device-ID supplier/contact snapshot + pendingSync | case 939 / suppliers.edit | Existing contact normalization, nullable fields and org scope. |
| `updateSupplier` | Partial supplier fields + pendingSync | case 960 / suppliers.edit | Undefined versus null/contact normalization and org scope. |
| `deleteSupplier` | Delete cached supplier | case 1001 / suppliers.delete | Existing server deletion behavior; do not add replacement/reassignment semantics. |

## Thin interface boundary, first slice only

A proposed `MaterialListStore` adapter can delegate the existing engine's local
read/subscription, typed named dispatch and existing sync-status observation.
Reads must preserve current `get`, prefix/index `scan`, entry ordering and
subscription error behavior; write dispatch must still run inside one Replicache
WriteTransaction. Engine acquisition, account/simulation storage naming,
quantity journal, close/reset and push/pull scheduling remain with their current
owners. Avoid inventing another queue, cache or transaction boundary.

A local dispatch promise means the current device transaction completed, not
that the server accepted the business write. Preserve that distinction in any
interface names/documentation. Existing pendingSync/status behavior must be
forwarded; a generic boolean cannot replace durable journal/engine state.

The smallest meaningful first extraction is **renameMaterialList only**: it has
matching simple device/server arguments and no pricing, room or supplier
snapshot envelope. A proposed `src/sync/mutators/rename-material-list/` groups one
input-schema definition, the unchanged device body and unchanged server body
side by side. Device and server entry points import their own side explicitly;
a browser barrel must not import server DB/auth/events, and a type import must
remain erased. Generate/infer the existing method's argument type from that
single schema without running new device validation. Keep the current mutator
map and server dispatcher as compatibility adapters, delegating just this one
case; all other names/default handling remain unchanged. This establishes the
pattern before mechanically moving the remaining 12, not a partial domain port.
The directory/file names here are proposals, not implemented APIs.

Do not bump schemaVersion, change database names, serialize a new envelope or
reset pending writes merely for this extraction. Old persisted mutation names
and args must continue to replay unchanged. Preserve local no-op returns,
transaction/notification ordering and the mutation permission map location or
its exact lookup behavior.

## Shared definitions are not currently identical

All 13 server Zod schemas exist, but client argument types are handwritten and
client bodies do not call those schemas. A shared schema must not accidentally
change the present wire contract:

- Server quantity input permits omitted materialListId; the client method type
  requires it. Do not narrow compatibility with old queued inputs accidentally.
- addItem/createMaterialList have device-only roomName and optimistic display
  snapshots; addItem also carries addedBy/part/supplier snapshots. The server
  schema strips unrecognized fields and resolves authoritative data. Parsing on
  the device with that stripped schema would remove data used for immediate UI.
- Supplier contacts are typed SupplierContact[] on the client but intentionally
  `z.unknown().nullable().optional()` on the server before normalization. A new
  stricter shared contact validator would change acceptance, not just move code.
- Existing `jobSupplierDefaultsSchema`/`supplierVersionSchema` and pure
  `purchaseLineTotal`/contact helpers are already shared where appropriate.
  Reuse them; do not duplicate or silently tighten their null/optional/default,
  rounding, offline-ID or normalization behavior.

For richer writes, preserve a wire-compatible union of authoritative input and
explicit device display-only fields with type-only references as needed. Server
parsing must remain at its existing dispatch stage; permission denial must not
start failing new parsing on the client first. Resolving these discrepancies is
part of the later extraction review, not permission to redesign inputs now.

## ACK, permissions and conflict semantics that stay identical

The push handler owns per-client ID sequencing, duplicate skip, gap rejection,
transaction retry, cursor advancement and batched quote/list side effects.
Extracted definitions must not duplicate those responsibilities. Permission
denial, known invalid-room/missing-list cases and unknown obsolete names are
currently acknowledged without applying; other errors abort the batch. A pull
acknowledgement therefore does not mean every business operation was accepted.
The current protocol does not carry the plan's quiet per-write refusal reason.
Adding that response/notice is a separately reviewed behavior change.

Existing pulls use exact prior CVR diffs/full-clear recovery and financial/org
scope, not new per-field server-time LWW, quantity-addition CRDTs, fractional
positions or universal delete-wins. Those are desired Phase 2 rules in the plan;
none should appear implicitly during a 13-mutator no-behavior-change port.
Role/account wipes, restricted partial views and durable external-send handling
also require their own design/evidence. Preserve server authority rather than
promoting optimistic snapshots into permission or pricing decisions.

## Smallest meaningful validation, later

Before the one-write extraction is accepted, compare old versus adapter device
transactions for missing/existing list and unknown extra fields, and server
calls for exact parsed args, org validation, permissions, hints and thrown
errors. Compile-time/name-map tests should catch changed wire names/arg shapes;
a browser import-closure assertion should plant a server import and fail.
Exercise old serialized rename args through the unchanged dispatcher, including
duplicate, gap, denial and failed-transaction cursor behavior. Keep current
13-name registration and obsolete-name ACK behavior checked.

Then rerun the existing focused contract tests and the already prepared
source-bound disposable real-DB runner under separate clearance. Its passing
R17 attempt validates existing assertions only; it is a baseline, not proof that
this future adapter is correct. Broader ports need existing room, sent-lock,
price/default and notification-idempotency cases, plus explicit parity tests
for the schema discrepancies above. No tests ran for this preparation note.
