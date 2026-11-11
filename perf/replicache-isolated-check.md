# Prepared disposable Replicache contract check

Runner and supervisor syntax checks pass; ten focused no-database supervisor/negative-input tests pass. One real-database attempt has now executed and **failed operational isolation before the first fixture insert**; see the result below.
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
