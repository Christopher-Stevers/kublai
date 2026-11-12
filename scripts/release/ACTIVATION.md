# Deployment preflight

The Phase 0 measurement bootstrap is already active. Later web changes use the
canonical builder and the guarded activation command from the canonical checkout:

```sh
node scripts/release/activate.mjs \
  --candidate /absolute/path/to/candidate-build \
  --baseline /absolute/path/to/baseline-1.json \
  --repeat /absolute/path/to/baseline-2.json \
  --report /absolute/path/to/candidate-lab.json
```

For inspection without switching anything, use `activation-gate.mjs` with those
same arguments and `--active /absolute/path/to/current-build`.

Before any switch, the gate requires two independent complete baseline matrices
at 4x CPU and matching source, median repeatability within 10%, a complete
candidate matrix, no journey regression beyond 10%, and no increased static
budget. Both matrices contain eight journeys, three link profiles, five samples
per cell. Reports carry the actual compiled lab build and a separate canonical
`sourceBuild` plus frozen-input `sourceFingerprint`; stubbing authentication for
the isolated lab never makes that artifact identical to the production build.

The candidate's actual changed JavaScript gzip bytes must equal the report's
deploy-byte metric. Every immutable asset in the currently active build,
including its retained history, must still have identical bytes. Current Brotli
and gzip sidecars must decode to the actual script. Static bundle metrics must
be collected from canonical release artifacts, not substituted with the smaller
auth-stubbed lab bundle. Incomplete evidence fails closed.

Each capture also carries a matching source-bound schema inventory and a passed
preflight of the 14 actual read endpoints used by the journeys. Its private
database log must contain zero ERROR/FATAL entries during the capture window.
A full matrix with a broken fixture is rejected, rather than treated as a fast
page load.

Activation requires the existing pinned service wrapper and canonical working
directory. It uses a lock and atomic symlink, restarts only `foremenhq.service`,
then checks health and exact served script/service-worker bytes. A failed restart
or check restores the previous release and restarts it. The command does not
install dependencies, change a database, rebuild or restart the worker, or alter
service configuration. It is not a substitute for public-edge checks afterward.

The four gate tests cover missing/self-reused/stale reports, a planted 30 KB
script increase, 100 ms tap regression, new polling, changed historical assets,
and mismatched compressed bytes. They do **not** establish the required 20
unchanged-build false-alarm trials. That remains a measured workstream-7 gate.

Field results remain a separate by-build signal as specified in section 13 of
the plan. This preflight never claims reference-phone results, completed Phase 0,
offline convergence, or a drawing-spike pass. Missing field baselines remain
listed in `perf/STATUS.md`; the first-week actions in section 18 can be prepared
and evaluated while they are collected.

## Active one-file fastlane — 2026-11-12

The approved Phase 0 source plus only CatalogueVisibility.tsx from `669d7f83`
passed the strict 33,690-byte update check, all 24 cells/120 samples, retained
assets and guarded activation. Active build is now `9aaeabbe…355b0`, source
fingerprint `34f0c150…82281d`; eighteen public edge checks passed. See
`perf/artifacts/wizard-fastlane-ready-then-pinch-v2-2026-11-12/`.

The original accepted baseline pair remains bound to Phase 0 `c25f525d…`,
not the new active source. This gate currently requires baseline/repeat to match
the actual active build. Subsequent releases must provide correctly bound
evidence and compute changed bytes against actual active fastlane; do not
relabel old reports or silently waive this condition.
