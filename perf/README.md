# Speed evidence

`node --test perf/check.test.mjs` proves the gate catches planted +30 KB script, +100 ms interaction, and a new polling query. It does not prove app speed.

`PERF_SHEET_PROTOCOL=ready-then-pinch-v2 PERF_BASE_URL=http://127.0.0.1:3481 PERF_JOURNEY_ADAPTER=./perf/journeys.mjs PERF_OUTPUT=before.json node perf/run.mjs` drives the eight named journeys at Basement (50,000 B/s, 400 ms), Site (300,000 B/s, 150 ms), Office, with CPU slowdown 4 and five independent contexts per cell. The adapter must implement all eight exports plus optional prepare, and resolve each only after observing its actual result. `staticMetrics()` returns measured sharedGzipBytes, screenGzipBytes, deployGzipBytes and idlePolls. The app must attest isolated seeded data at /api/perf-lab. The driver refuses remote origins, blocks outgoing browser requests, and provides no production-data fallback.

`node scripts/check-speed-budget.mjs --baseline before.json --report after.json` requires all 120 valid measurements and fails a median regression exceeding 10%, any added static script bytes or any added poll. Reports must contain version:1, provenance:'isolated-seeded-app', cpuSlowdown:4, build:<measured Next BUILD_ID>, samples:[{journey,link,run,durationMs,variant}], static:{sharedGzipBytes,screenGzipBytes,deployGzipBytes,idlePolls}. Targets in budgets.json are goals, separate from measured ratcheting baselines. Do not invent baseline values. Explicit budget raises require reviewed changes to the baseline with rationale in the same commit.

Baseline evidence: six complete desktop-emulated captures are archived. The first two `early-pinch-v1` runs failed Site sheet/pinch repeatability; the first separate `ready-then-pinch-v2` pair failed Basement material-list repeatability (203.9 → 229.0 ms, +12.35%). Those four captures remain rejected and unchanged. The separately sealed v2 rerun archived on 2026-11-11 passes all 24 cell-median repeatability checks in two complete 120-sample runs, with source/method binding and zero private-database errors. This accepts same-build lab repeatability only. See `artifacts/baseline-ready-then-pinch-v2-rerun-2026-11-11-assessment.json` and its independent `-pair-summary.json`; no pooling, exclusions or threshold changes were used.

The committed field checkpoint measured at 2026-11-11 04:22 UTC contains 60 beacons / 1,428 observations, including four phone-class INP observations and three tap-to-paint observations; earlier raw checkpoints remain preserved. Phone viewport classes are not per-row verified hardware, and these small/uncontrolled samples are not stable field percentile proof. No accepted candidate before/after comparison, 20 unchanged-build false-alarm trials, controlled real-phone, Safari, offline matrix or week-long field evidence exists. Phase 0 remains incomplete until every section 2 row has actual repeatable evidence. Lab medians are not field p75 or interaction p95. Prepared R4 passes the three canonical byte regression ratchets; the separate controlled R2→R3 edit passes at 22,739 gzip bytes, while the photo-feature update totals 283,891 bytes. These static proofs are not activation, phone transfer or final 120 KB / 180 KB target passes. See STATUS.md and baseline-evidence.json for measured-at context.

The client emits bounded numeric-only web-vitals and existing foremenhq performance measures to /api/perf. Normal session middleware protects this endpoint. On Node set PERF_LOG_DIR to a private, persistent directory for daily JSONL files; otherwise the Node sink defaults to data/perf. PERF_LOG_BACKEND=console selects platform logs for hosts without persistent writable storage. Rotate daily logs with the host's existing retention process. No database, worker service or hosting is introduced. Existing measure details, paths and IDs are never sent. Build/screen/device/link tags are coarse allowlisted classes; unknown build remains visible. node perf/field-report.mjs consumes daily files and groups p75/p95 by these tags, flagging INP p75 >=50ms. Viewport classes do not establish physical phone evidence.

`perf/lab/database.sh` creates disposable Unix-socket PostgreSQL. Within that wrapper, `node perf/create-lab-snapshot.mjs` copies a separate source tree, ignores all .env files, and generates a webpack config aliasing Clerk to a seeded user. It validates the private socket and fixed test database, writes a PERF_LAB_ONLY marker, and copies generated fixtures/assets. Build and start only that tree with Next production webpack mode. Canonical application authentication is unchanged. These lab runs exclude Clerk script bytes and sign-in timing; they cannot prove authenticated cold startup performance. Never deploy a PERF_LAB_ONLY tree.

Navigation journeys openjob/switchjobtabs/openmateriallist explicitly warm the destination through the client router and return before the timed second visit; reports label those samples variant:visited. Journey durations include browser automation/assertion overhead and are not field INP or p95 tap-to-paint. --expected-build on the deploy wrapper binds evidence to the intended candidate. `node perf/check.mjs --repeatability --baseline first.json --report repeat.json` requires two distinct full captures of the same build with each cell median within 10%; this is a lab-only repeatability check, not the complete Phase 0 gate or evidence of twenty stable runs. `PERF_SOURCE_ROOT=/path/to/approved/source` selects the copied application source separately from the current harness. Freeze a copy of pilot.sh before executing it; do not edit a shell file while it is running.

## Explicit protocol and per-run evidence

A harness hash alone does not bind environment-selected behavior. R17's first
full capture omitted `PERF_SHEET_PROTOCOL`, used the older default, and was
correctly rejected before comparison. Its complete raw report remains archived.
For comparisons against the accepted v2 baseline, the frozen launcher must
explicitly export `PERF_SHEET_PROTOCOL=ready-then-pinch-v2` and set the exact
`PERF_COMPARISON_BASELINE`. Run `node perf/lab/check-protocol-config.mjs` before
starting the disposable database, then again before idle observation and the
journey matrix. Archive its allowlisted effective environment, launcher/helper
hashes, and exact command; do not dump the full environment or rely on defaults.
Use the reviewed frozen copies during a capture; changing current tooling never
changes a sealed method retroactively. The command above describes the driver,
not a substitute for the source/fixture/static/preflight orchestration.

Preserve that run's actual schema inventory, fixture identities, source checks,
read preflight and private database health evidence before automatic database
cleanup. A prior run's schema file cannot substitute. Copy failures must propagate
even when cleanup functions are called in shell conditional/OR contexts. The
protocol and cleanup smoke tests in `perf/lab/` run without a database/browser;
they do not prove application speed. See the recorded R17 attempt2 preparation
for the exact reviewed launcher and test evidence.
