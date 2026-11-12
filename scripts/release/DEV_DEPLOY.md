# Dev deployment command

The dev lane deploys committed work after its own checks, a canonical production
build and runtime health checks. Timing/byte results go into review afterward.
It never migrates a database, releases a worker bundle, enables organization
slip autopilot or deletes application data.

```sh
node scripts/release/dev-deploy.mjs \
  --source /absolute/frozen-source \
  --manifest /absolute/runtime-provenance.json \
  --checks /absolute/own-tests-receipt.json \
  --build /absolute/frozen-source/.next-web \
  --agent agent-name \
  --summary 'What changed for the user'
```

`--help` describes the supported interface. Current proven source mode is an
explicit active-based, merged-commit hunk snapshot: the manifest names the active
base source/fingerprint, exact runtime pre/postimage hashes and sequential
committed hunks. The tool reconstructs those hunks from commits merged into
`tim-development`, rejecting unlisted changes. Do not copy mutable HEAD wholesale
or reuse another source's test receipt. Public/config/script overlays and a
fully generic merged-HEAD snapshot mode need explicit provenance support; the
tool currently refuses them rather than silently accepting unrelated inputs.

The own-test receipt binds sourceFingerprint and successful command/log SHA256
records. Next's successful canonical build with its TypeScript gate enabled
supplies the production type check. One lock (`.release-activation.lock`) spans
preemption, checks/build, packaging, switch/restart and queue write. The pinned
worker-separate service alone restarts. Candidate public files are preserved;
previously packaged-only extras and immutable static history remain available.
Sign-in200, protected user.getMe401, changed script bytes and SW bytes are checked.
Health or queue-write failure automatically restores/restarts/checks the previous
release. Attempts are recorded under `.dev-deploy-attempts`; successful entries
are atomically inserted newest-first at `<!-- DEV_DEPLOY_ENTRIES -->` in
`perf/REVIEW_QUEUE.md`. Changed gzip/large-change flags are review metadata.

## Registered timing runs: dev has priority

Before launching a timing job, its owner must use the exported `withDeployLock`
helper for the short **spawn + initial ownership-record verification + registry
write** transaction, then release it immediately. Do not hold this lock during
the timing run. Atomically publish one repo-root `.perf-active-run.json`:

```json
{
  "version": 1,
  "sessionId": "calibration15-20261112",
  "sessionRoot": "/tmp/foremanhq-calibration15-20261112-session",
  "ownershipRecord": "/tmp/foremanhq-calibration15-20261112-session/resume1-outer-processes.json"
}
```

The ownership record must already exist, belong to the current user and contain
the existing owned-process-supervisor's token/PID/start-time identities. It must
resolve inside sessionRoot. `activeStage` is optional and only a hint; it is never
asserted as the exact interrupted stage. A timing owner removes its registry only
if the bytes still match its own registration.

Under the dev lock, `preemptTiming` stops **only that registered owned family** via
`owned-process-supervisor.py stop` with a20s outer bound (the normal stop has a6s
supervisor grace). It requires proof that both supervisor and family are absent.
It writes a unique session-local interruption record with reason
`dev-deploy-priority`, `spoiled:true`, `repeatLater:true`; completed raw captures
and earlier verdicts are never rewritten. The in-flight stage must be preserved
as interrupted and repeated later by the timing owner. Registry removal is
compare-and-unlink: a newer registration is preserved and blocks this attempt.
Missing registry means no process is stopped. Malformed registration, escaping
record or failed stop proof fails closed; no unregistered PID is killed.

Production promotion remains a separate reviewed-batch decision and gate.
