# Prepared disposable Replicache contract check

Runner and supervisor syntax checks pass; ten focused no-database supervisor/negative-input tests pass. Two separately authorized attempts are preserved below: the first failed operational isolation before the first fixture insert; the corrected actual-client method passed the existing contract check.
Root review and a free canonical-build/benchmark slot are required first. No
change to the existing assertion program or production implementation is made.

Proposed exact R17 invocation from the canonical checkout:

```sh
node scripts/check-replicache-isolated.mjs \
  --source /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r17-20261111 \
  --build /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r17-20261111/.next-web \
  --expected-build b1c2adf31950c6f3db7ab189bbeabce29df5d6d9766418f3a9935bdde94f234b \
  --expected-fingerprint be7f23501ec71b78974bc9f818fc75b46abfd0a4de0ad83288de7a49826c37cc
```

The runner requires all four explicit inputs, compares canonical BUILD_ID and
webpack manifest identities, verifies the frozen source fingerprint, rejects a
lab-transformed source marker, and verifies a copied source fingerprint before
running anything. It copies only selected source/public/scripts/vendor and
named build configs, refuses symlinks inside copied trees, and does not copy
env/private/upload/output directories. Node dependencies are the selected
release's resolved installed tree; no install occurs.

It creates a mode-0700 fresh `/tmp/foremanhq-perf-pg.*` directory and an independently
mode-0700 evidence directory. PostgreSQL 18 starts with **no TCP listener**, a
unique Unix socket, a newly initialized data directory and the fixed disposable
name `foremanhq_perf_lab`. Child environments are built from an allowlist, with
an explicit private URL; inherited DATABASE_URL, dotenv, NODE_OPTIONS and service
credentials are not used. Before dynamically importing the unchanged frozen
`scripts/check-replicache-sync.ts`, a guard verifies URL host/port/database,
`current_database`, null `inet_server_addr` and the exact owned server data
directory. It never executes the existing check against an arbitrary URL.

Schema bootstrap reuses the current lab schema inventory/export/order helpers,
without the broad lab seed (which would create PDFs/assets unrelated to this
contract). All source-declared schema modules come from the frozen copy.
Operational helpers are separately hashed and copied. Three existing migration
inputs are separately hashed and copied too: `0039_reliability_revisions.sql`,
`0045_material_room.sql`, `0091_job_pricing_sync.sql`. They establish the existing
revision function/triggers on the fresh schema, not a new sync behavior. This is
**not** a full historical migration replay or verification of a deployed schema.
If an exported shape or required migration function fails, stop and preserve the
failure; do not edit assertions or invent schema to obtain a pass.

The original check creates/removes its own synthetic organization and tests
snapshots, exact/missed base views, concurrent pull order, ownership, offline
mutation acknowledgements/replay, duplicate IDs and deletion healing. No mutator
is ported or weakened. `NODE_ENV=test` uses existing background-hint suppression;
therefore this check does not verify live hint delivery. No auth stub/application
server, worker release, phone, browser or performance matrix is involved.

Each child has a bounded timeout, and the supervisor has a seven-minute deadline.
Interrupts/deadlines terminate the owned child process group. Finally it stops
only its own PostgreSQL data directory, preserves private PG/schema/check logs,
source binding and operational hashes, counts ERROR/FATAL entries, then removes
the temporary source/database directory only after confirming shutdown. A failed
stop retains that directory and marks failure rather than deleting live files.
Results remain private until a separately reviewed metadata-only summary.
Existing check success alone is not enough: any PG error/fatal or cleanup failure
fails the wrapper. Actual schema bootstrap and one bounded real execution remain held until explicit root clearance.

Reviewed hardening: the required actual PostgreSQL log is copied/read only after
owned shutdown and before temporary-directory deletion. Missing/copy/read log
evidence yields unknown error counts and failure, retaining the directory. A
pass requires explicit exit 0, no deadline/interruption, confirmed shutdown,
preserved log, zero ERROR/FATAL and successful removal. Each command's timers
capture its own PID/group, cancel deferred SIGKILL on exit, and reject a forced
shutdown that never signals exit. Cleanup pg_ctl has an independent 15-second
outer deadline plus its existing `-t 10`; data is retained unless stopped. The
main deadline is checked again after final source verification.

No-database tests cover CLI missing/mismatched identities, timeout/interruption,
forced shutdown, stale kill timers versus a later child, cleanup's independent
bound, final log order/failure, and retained data on unconfirmed stop. The
unchanged check's exact output path was verified from source as
`.tmp/performance-implementation/sync-integration.json`; only that completed
artifact is copied as the assertion report.

Source review of revision SQL: 0039 uses IF-NOT-EXISTS table/column setup,
CREATE-OR-REPLACE revision function and named trigger replacement; 0045 uses
IF-NOT-EXISTS room columns/indexes and guarded named constraints plus its room
name trigger; 0091 only replaces revision triggers on source-declared pricing
tables. These operations target the fresh exported schema only. Compatibility
with that actual export is still an execution check, not claimed by source
review: every psql call uses ON_ERROR_STOP, preserves its log and aborts on any
missing table/constraint/function mismatch. No production migration runs.

## Sole authorized attempt: failed connection binding

The final reviewed runner (SHA256
`73f44233c71d6ec2bc6997b6b4748ce61b6da0463a922b331502b00e90dca4c0`)
used `psql -X` for both schema and revision SQL. Schema export and all three
revision inputs completed. The explicit-options guard successfully checked the
private server, but the unchanged app's `postgres(DATABASE_URL)` ignored URL
query-string host/port and attempted localhost:5432, which refused connection
before the first fixture insert. **No contract assertions ran or passed.**

The installed `postgres@3.4.8/src/index.js:438–439` selects host/port from explicit
options, URL authority or PGHOST/PGPORT; query host/port do not bind the socket.
Thus the guard's independent explicit-options connection did not verify the
actual application connection. The earlier proposed command is retained as
failed-method provenance and must not be rerun as a safe method unchanged.
A future correction must verify the same driver/client used by the application
before any import or fixture write, with a separately reviewed operational
binding. No assertion edits or automatic retry were performed.

The owned PostgreSQL stopped, its actual final log was preserved after stop,
and the temporary data/source directory was removed. PG ERROR/FATAL counts are
zero. The mode0700 evidence remains at
`/tmp/foremanhq-replicache-proof.SWXvdd`; private schema/SQL/content logs remain
outside git. [Metadata-only failed-attempt proof](artifacts/replicache-isolated-attempt1-2026-11-11.json)
records source/method/log hashes and cleanup. Ten no-database supervisor tests
passed; that result does not cure the application connection-binding failure.

## Corrected actual-client method, prepared only

The proposed second method keeps the failed attempt unchanged. The child gets
explicit scrubbed PGHOST=owned socket, PGPORT=55463 and
PGDATABASE=foremanhq_perf_lab, with the hostless
`DATABASE_URL=postgres:///foremanhq_perf_lab` (no host/port query parameters).
The separate PERF_LAB_DATABASE_URL remains only the existing schema helper's
compatibility guard; that helper's database config uses explicit socket options.
It is not the application's connection URL.

The generated entry first validates that exact environment, then dynamically
imports the unchanged canonical `src/server/db/index.ts`. Before any SQL, it
checks the actual Drizzle `db.$client.options` forwarded by the timing proxy:
exact Unix socket path, singleton owned host/port arrays, fixed database and
SSL false. It also requires those options to be the application global cache's
options. Only then does that same actual client perform a read-only transaction
verifying current_database, null inet_server_addr, owned data_directory and
transaction_read_only=on. The unchanged check imports the same module/cache
afterward; no alternative client is injected and no app source is transformed.
The finally block closes the actual client/cache, including on guard refusal.

No-database tests use the installed postgres3.4.8 options parser without issuing
SQL: expected hostless parsing succeeds; the original bad URL, TCP authority,
wrong socket/path/port/database and missing/extra environment fields reject
before connection. Generated-entry syntax is checked without importing app
code. A newline-escaping preparation defect was caught by that syntax test and
fixed before any real run. All 15 no-database checks pass. Real execution of
this corrected method remains held for separate root review/clearance.

## Separately authorized corrected attempt: passed existing assertions

The reviewed actual-client runner (SHA256
`1b228ed761b684b1e9e3047cfd7a1db8bd913133d63dc854f58e9aa8d92b6ca0`)
ran once against the exact R17 source/build above and a fresh owned PostgreSQL.
Actual app-client options passed before SQL; the same client's read-only server
identity and shared cache check passed before importing the unchanged assertion
program. All existing assertions completed, including 16 reported pull
checkpoints covering missed/interrupted views, concurrent pull order, mutation
acknowledgement/replay, duplicate IDs and deletion healing. The checkpoint count
is not a count of every assertion or a performance measurement.

The full seven-minute deadline did not expire. PostgreSQL logged zero ERROR/FATAL
entries; its final log was preserved after stop. The owned server stopped and
temporary source/data directory was removed. Private evidence remains at
`/tmp/foremanhq-replicache-proof.YtBOMq`; only
[metadata and hashes](artifacts/replicache-isolated-attempt2-2026-11-11.json)
are committed. Attempt 1 is unchanged and is not backfilled as passing. No retry
within either authorization or production/auth/worker/browser change occurred.

This validates the existing server-side contract assertions for this frozen
source and fresh schema. It does not prove live hints (disabled by existing test
mode), real authentication, browser durability, long offline convergence, every
mutation/permission race, Phase 2 rollout or a production migration.
