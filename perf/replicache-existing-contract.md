# Existing Replicache sync contract

Source inspection on 2026-11-11 for SPEED_PLAN §8 step 3. This describes existing
material-list/job/supplier sync and shared pull views, not a new engine contract,
Phase 2 rollout or a convergence result. No tests or database operations were
run to prepare this note. References below are repository paths and source line
anchors at this checkpoint.

## Identities and access

`src/server/replicache/pull.ts:16` inserts a client group then updates it only
when group ID, organization and user all match. That write serializes a group's
pulls/pushes; a conflicting owner throws `ReplicacheOwnershipError`.
`material-list-sync.ts:220` similarly binds each client ID to group/org/user;
its mutation cursor starts at zero. Request `profileID` is not the ownership key
used by these handlers. Mutation counters are per client, not organization-wide.

The material-list pull/push routes create a request context, return HTTP 401
without a user, and HTTP 403 when a present organization-access status is not
`approved`; ownership errors become protocol `ClientStateNotFound`. Other
exceptions become HTTP 500 `PullFailed`/`PushFailed`. Handlers additionally require
an organization. These are request-context checks, not a fresh database role
read before every mutation in a batch. Push resolves permissions once from that
request user (`material-list-sync.ts:1062–1070`).

The material-list full view is **organization-scoped**, with jobs/lists/quote
items/suppliers selected by organization (`material-list-sync.ts:1198–1316`).
Do not describe it as per-job membership filtering. Shared view scope is
`kind:org:schemaVersion:view-v3:money-boolean` (`pull.ts:90–93`), not per user.
Financial permission changes select a different scope and redact values before
view creation; this is not a general per-row authorization/version framework.

Client storage is named `simulationCacheName("foremenhq-material-lists")`, with
schema `material-lists-v2` (`src/lib/replicache-material-list.ts:548–570`,
`src/lib/replicache-schema.ts`). Simulation adds a simulation-ID suffix; the base
Replicache name itself does not embed org/user. The separate quantity journal
uses org/user plus simulation (`replicache-material-list.ts:680–704`). Bootstrap
binds the live account and closes engines/journal on its account-effect cleanup
(`components/offline/ReplicacheSyncBootstrap.tsx:33–90`). Those facts alone do not
prove all-tab account purge or offline revocation safety.

## Versions, cookies and patches

Material-list handlers accept schema `material-lists-v2` and protocol pull/push
version 1; unsupported versions return `VersionNotSupported` with the relevant
version type (`material-list-sync.ts:1020–1028,1070–1078,1189–1194`). Catalogue
uses `catalogue-v1` and the same shared pull mechanism; its push route currently
acknowledges `{}` after access checks and performs no catalogue mutation.

`pull.ts:55–68` reads the transactional global and organization revision pair
from `kublai_sync_revision`. Existing migrations install source-write revision
triggers (`drizzle/0039_reliability_revisions.sql`, with room/pricing extensions
in `0045_material_room.sql` and `0091_job_pricing_sync.sql`). This counter pair
selects a cached full projection; it is not the pull order or a row timestamp.
Correct reuse depends on actual installed producer/trigger coverage, which this
source review does not independently verify against a database.

Each repeatable-read pull transaction captures client mutation acknowledgements,
revision and view together. Pull order is the greatest of persisted order+1,
clock milliseconds and a validated incoming order+1. Invalid/unsafe incoming
orders fall back to zero. The response cookie is `{order, cvr}`; `cvr` is a random
in-memory view ID, distinct from the group `cvrVersion` bumped by push.
Serialization failure `40001` retries up to four attempts (`pull.ts:70–176`).
Views become reusable only after transaction commit (`pull.ts:159–160`).

`views.ts:15–105` retains at most 64 views and a nominal 48 MiB, with a 30-minute
inactivity TTL; successful committed pulls refresh TTL/LRU position. A view holds
put rows and SHA256 hashes of JSON values. Given a valid same-scope exact base,
diff emits `del` for keys absent now and `put` for new/changed JSON values.
It does not assume the previous server revision reached the client. Missing,
malformed, expired, evicted, restarted-process or foreign-scope bases yield
`clear` plus every current row. This fallback is the recovery mechanism; there
is no durable CVR journal or requirement to receive every intermediate hint.

Material-list projection keys are `job/`, `materialList/`, `materialListItem/`
and `supplier/`. The builder starts with clear+puts, but `ReplicacheViews.create`
retains only puts and computes the actual full/delta response. Deletes therefore
follow authoritative absence from the exact prior projection, not solely the
mutation tombstone tables. Delete mutators also record existing tombstones,
including an already-missing list (`material-list-sync.ts:334–376,876–937`).

## Push ordering, acknowledgements and side effects

`material-list-sync.ts:1080–1165` processes the received array in order within
one retried transaction. For each client, IDs below last+1 are duplicates and
skipped; an ID above last+1 throws and aborts the batch. An exact next mutation
advances the stored cursor after dispatch. No cross-client total order or CRDT
merge rule is defined here. Deadlocks/serialization failures retry the whole
transaction at most three times with 50/100 ms backoff (1041–1058).

The 13 names map to current permission keys (70–85): create/update/delete job;
create/rename/delete list; add/remove item; update quantity/supplier part;
create/update/delete supplier. Permission denial is **acknowledged without
applying** so it stops replaying. Missing list and invalid/deleted/foreign room
errors are also acknowledged selectively; other validation/database errors
abort the transaction. Unknown/obsolete names are intentionally swallowed and
acknowledged (`1014–1017`). An acknowledgement is therefore not a universal
"accepted business write" receipt. The next pull reconciles optimistic state.

Domain handlers use organization predicates, validated room/list relationships,
real IDs, and existing sent-item row locks; stale edits to sent rows are
acknowledged without changing them (`382–402,423–429`, relevant mutation cases).
Totals/list touches coalesce once per affected ID inside the transaction.
An organization Replicache poke follows a successfully committed transaction
when the applied counter is positive (`1167–1175`); some domain material-list
hints are called from inside dispatch, so do not claim every hint is a
transactional/durable commit record. Pull remains authoritative. Notification
idempotency also uses `replicache:clientID:mutationID` event keys. The applied
counter is not a durable result log or proof that each dispatch changed a row.

Client mutators are optimistic local transactions; sync currently retains a
60-second fallback pull, 250 ms push delay, and bounded request delay. Online,
visible and live catch-up request earlier synchronization. Local durable quantity
intent recovery is a separate journal, not a new server mutation protocol.
This note does not convert direct server actions, external sends or receipts to
queued Replicache operations.

## Existing coverage and explicit gaps

Existing test **source**, not a claim of execution in this task:

- `src/server/replicache/views.test.ts`: exact missed-revision/deletion diffs,
  interrupted response base, foreign/unknown/expired/evicted cookie fallback,
  and active versus idle TTL.
- `access.test.ts`: mocked request identity approved→rejected and unauthenticated
  route rejection before invoking sync handlers. It does not test real Clerk,
  live database revocation or all-tab offline data removal.
- `material-room.test.ts`: room attribution/rejection and draining rejected
  creation/orphans, notification replay, sent-row locks, supplier/default price
  selection, and scoped metadata-only reads. Its database/transaction mocks do
  not establish PostgreSQL locking/concurrency behavior.
- `catalogue-sync.test.ts`: bulk aliases projection including empty aliases.
  `src/lib/replicache-material-list-room.test.ts`: optimistic room/quantity/
  supplier/sent-row/default behavior, using its local transaction fixture.
- `scripts/check-replicache-sync.ts`: an existing real-database check program
  for initial/unchanged pulls, missed/interrupted revisions, concurrent pull
  orders, group ownership, offline create/update/delete replay, duplicate IDs,
  acknowledgements and missing-CVR healing. It writes fixtures; it was **not run**
  here and must not be run casually against production.

Remaining explicit contract tests before extension should cover real concurrent
push/pull and first-registration races, gap rollback, denied/obsolete mutator
acknowledgement versus business acceptance, transaction retry side effects,
financial-scope change, all relevant trigger producers/direct SQL/deletes,
restart/eviction plus pending local writes, and account/simulation boundaries
across tabs. Existing source/tests above are not exhaustive proofs of those
properties. Phase 2's broader store abstraction, additional domains, long offline
convergence, permission-change handling and destructive/review/external-send
rules remain desired work, not behavior supplied by this short specification.
