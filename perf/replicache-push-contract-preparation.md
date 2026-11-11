# Supplemental existing push contract — proposed check

Prepared source-only during R18 quiet; subsequent reviewed validation and the sole authorized database outcome are recorded below. Root reviewed the five
assertions and authorized the enumerated runner extension as source edits; no
execution or commit until its follow-up review. The original `scripts/check-replicache-sync.ts`, frozen R18
application, baseline method, production schema and worker stay unchanged.

New operational script: `perf/replicache-push-contract.ts`. It imports the actual
frozen handlers/schema/client from the disposable source root, requires an
owned socket/source path and an explicit runner binding marker, checks the
actual client options again, and refuses another canonical source identity.
The intended application is exact R18:

- Build: `c58613f12a7ae0590934ecdb15ddbc7a39e3a2f587f26d5f98792c92a4de64e8`.
- Source fingerprint: `ec149c2ed24935019cae5150c928b9af6606d8c41c8eba552d2a9185cf1b05dd`.

## Missing evidence targeted

Five cases use only a synthetic organization/user/job, actual direct push/pull
handlers, and independent client streams. They examine authoritative row state,
actual stored cursor and pull acknowledgement; a successful `{}` alone is not
acceptance evidence.

1. **Per-client gap / whole-batch rollback:** two clients in the same group each
   establish ID 1. A batch containing a valid first-client ID 2 followed by a
   second-client gap ID 3 must reject specifically as out-of-order; earlier row
   changes and both cursors remain at their prior committed state. The expected
   second-client ID 2 can subsequently apply without advancing the first client.
2. **Duplicate with changed payload:** retry ID 1 with a *different* job name.
   Name/updatedAt and cursor must remain unchanged. This is stronger than the
   original check's identical idempotent quantity retry, which could hide a
   repeated dispatcher execution.
3. **Denied ACK:** a constructed non-admin request user with jobs.edit=false
   sends invalid updateJob arguments. Existing permission-before-parse behavior
   consumes ID 1 without applying or failing validation. Restoring permission
   cannot replay that same consumed ID; a new authorized ID 2 works. This tests
   captured handler permission semantics, not authentication/role-refresh paths.
4. **Obsolete ACK:** an unknown name consumes its ID without changing the domain
   row and does not block the following known mutation. Do not assert unchanged
   group cvrVersion or no hint: current bookkeeping can change for these ACKs.
5. **Hard validation rollback:** after a committed baseline, a valid update
   followed by an empty-name Zod failure must abort the whole transaction,
   restoring the earlier domain write and cursor. A separately issued expected
   ID can then apply. The rejection must be the specific name-validation issue,
   not an arbitrary setup/database error.

Case 5 intentionally uses an unhandled validation error inside the real
transaction. It is not a PostgreSQL constraint/deadlock/retry test and should not
create a deliberate PG ERROR that would weaken the runner's zero-error rule.
No expected server exception is swallowed unless it matches the asserted gap or
name-validation condition. Any unexpected error aborts the suite and is retained.

## Reviewed runner extension prepared, not executed

Prepared one enumerated `--check push-contract-v1` option to the existing operational
runner; default `existing` keeps the original assertion program unchanged. No
arbitrary script path option. Hash the selected supplemental script before
copying, freeze that content into the copied root's `perf/` directory (outside
release fingerprint inputs), record the hash separately, and verify the copy.
Do not copy a current application source tree or alter the source fingerprint.

Retain every current fence: explicit canonical source/build/expected IDs,
fingerprint before/after; scrubbed hostless URL and explicit private PGHOST/
PGPORT/PGDATABASE; actual app db.$client.options before SQL; same actual client's
read-only server/cache verification; psql -X; schema inventory and separately
hashed revision SQL; seven-minute supervisor/child/cleanup deadlines; final PG
log after stop, zero ERROR/FATAL and confirmed cleanup. No new connection,
browser, auth stub or worker is required.

After that existing actual-client guard passes, write a mode-0600 marker
`ISOLATED_REPLICACHE_BINDING.json` in the owned copied root containing the exact
source build/fingerprint, mode, supplemental file SHA256 and
actualApplicationClientVerified=true. Then import only the selected script.
It verifies the marker/hash before app-handler imports. Copy its exact output
`.tmp/push-contract-v1.json` to a distinct private evidence name. Source/report
hashes and actual guard/cleanup metadata accompany a later metadata-only public
summary; SQL/logs/identifiers remain private. Preserve the two earlier original
check outcomes unchanged. New expected invocation is the reviewed R18 identity
arguments plus `--check push-contract-v1`; the prepared runner accepts this mode, but it has not been executed.

Before any real execution, review script assertions and implement only the
approved enumerated runner path, followed by scoped syntax/types and no-DB
negative binding/mode/hash tests under separate clearance. During this task no
tests, imports, processes, SQL, schema/bootstrap, render or commit occurred.
Passing later would close these specific existing-contract gaps, not establish
new mutator definitions, engine abstraction, broad offline convergence or Phase 2
rollout.

The extension now records mode, selected program and supplemental SHA separately
from the canonical source fingerprint. Unknown/missing/duplicate mode arguments
reject before source/evidence/DB setup. Default existing keeps the exact original
program, stage/log selection and report path. Operational selection/supervisor
helpers are copied outside application fingerprint inputs, with hashes verified.
The supplemental binding marker is created only in the generated child after
actual-client options and same-client read-only server verification. The test
checks its own copied hash plus exact R18 binding before handler imports, and
the runner verifies the file hash again after completion.

Queued no-DB tests cover mode/default compatibility, arbitrary paths/unknown
modes, marker missing/false status, source/hash mismatch and CLI rejection before
setup. Existing generated-entry syntax fixture is prepared to handle the selected
program metadata. No tests or syntax checks have run on this extension. The
hard-failure matcher now requires exactly the installed Zod name `too_small`
issue (minimum 1, inclusive, path exactly name); post-gap recovery also asserts
the new domain name, not only cursors. Source reference: installed Zod's
string-length checks emit code too_small/minimum/inclusive for min(1).

## Post-quiet operational validation checkpoint

After explicit release, the 19 no-database selection/connection/supervisor tests
pass, including generated-entry syntax and guard/marker/import order for both
modes. Runner and selection helper syntax checks pass. The supplemental script
passes scoped strict/noUncheckedIndexedAccess TypeScript with no emit. Formatting
was confined to the owned changed files. No real database or supplemental
handler assertion has run, and nothing is committed at this checkpoint.

Prepared invocation after root review (not executed):

```sh
node scripts/check-replicache-isolated.mjs \
  --source /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r18-20261111 \
  --build /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r18-20261111/.next-web \
  --expected-build c58613f12a7ae0590934ecdb15ddbc7a39e3a2f587f26d5f98792c92a4de64e8 \
  --expected-fingerprint ec149c2ed24935019cae5150c928b9af6606d8c41c8eba552d2a9185cf1b05dd \
  --check push-contract-v1
```

The original runner outcomes and frozen R18 remain unchanged. No timing gate is
rerun, waived or replaced by these operational checks.

## Sole authorized supplemental run: five cases pass

After root reviewed the final runner/selection/script hashes and 19 no-DB
tests, one bounded actual-database run used the exact invocation above. It
exited 0; all five cases passed. Actual app-client options were verified before
SQL, then that same client verified the owned server in a read-only transaction
before the supplemental marker/import. The script hash/source/mode marker and
source fingerprint matched before/after. No source/method/assertion edit or retry
occurred during the attempt.

PostgreSQL recorded zero ERROR/FATAL; its final log was preserved after stop.
The owned server stopped and temporary source/data directory was removed, with
no timeout/interruption. Evidence remains private at
`/tmp/foremanhq-replicache-proof.OdETDl`. Only
[metadata, named cases and hashes](artifacts/replicache-push-contract-r18-2026-11-11.json)
are committed. Earlier failed/passing original-check outcomes are unchanged,
and the original assertion program itself was not modified.

This closes the five stated direct-handler checks for existing frozen R18
semantics. Constructed request-user permissions do not test real authentication
or database role refresh. The hard error is Zod validation inside a transaction,
not a deliberate SQL constraint/deadlock/retry. No browser, live hint, engine
extension, full offline convergence, production schema/worker change or activation
is established. R18's failed performance gate remains independent and unchanged.
