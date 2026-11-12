# Deployment preflight

## Dev and production are separate lanes

Tim’s [2026-11-12 policy](../../perf/DEV_LANE.md) authorizes immediate Omarchy dev deployment after merged source, its own tests/type checks and the canonical build pass. Use `dev-deploy.mjs`; it serializes builds/switches, retains assets, checks sign-in/protected endpoint/served scripts, rolls back failed health and writes the review queue. Timing matrices, baseline pairs and byte ratchets do not block dev. Dev preempts active timing collection. The rest of this document describes **production promotion**, not a dev activation requirement.

Review deployed dev batches afterwards against the last reviewed build. Findings become tasks. Only a broken journey or a >25% slowdown confirmed twice prompts an immediate rollback decision from Tim. Production promotion requires a reviewed batch with no open serious finding and all full-gate evidence below. No separate production host is assumed to exist; the Omarchy endpoint currently serves users.

Database/schema changes, worker releases, enabling autopilot and deleting data/files remain outside the dev lane without explicit approval for each.

## Production preflight

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
at 4x CPU and matching active source, a completed method calibration, and a
complete candidate matrix under the calibrated15-sample directional
dual-threshold/sole-confirmation rule below. Static non-growth is unchanged.
Each full matrix contains eight journeys, three link profiles and fifteen
samples per cell. Historical f9/v2 used five and retains its original verdicts.
Reports carry the actual compiled lab build and a separate canonical
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

## Calibrated timing protocol (authorized 2026-11-11)

Byte limits are unchanged. The abandoned300KB proposal was not adopted. The new
`ready-then-pinch-v2-calibrated-15-v1` protocol keeps original f9/v2 wall-clock
journey boundaries and uses15 samples per cell (360 in a full run). A cell fails
only when its median delta is BOTH greater than10% of fixed baseline B and
greater than17ms. Equality passes; faster variation is diagnostic only. All
original captures/verdicts stay immutable and retain their original method IDs.

Every initially failed timing cell receives precisely one prospectively sealed,
fresh15-sample confirmation against the same B. The exact failed set is captured
once, without pooling, resetting or retaining only fast samples. Missing,
duplicate, stale, extra, wrong-source or wrong-method evidence fails closed.
A cell rejects only if it fails both times. Byte/auth/source/health failures do
not receive this exception. Confirmation records the equivalent fixture prelude.

Before candidates can pass, a separate completed calibration bundle must contain
one fixed B plus19 independent unchanged-build full controls, with confirmations
where needed and every final control passing. This validates the method once;
it is not20 new full runs for every release. Future releases still need their
own matching-active-source independent baseline and repeat, under the calibrated
method/toolchain. Calibration source may differ from later active source; its
20 runs must be internally source/build identical.

Bundles carry exact original report/plan text as `{raw,sha256}` entries. Every
capture carries prospective plan and source/build/harness/CPU/health provenance.
`--calibration` supplies `{status:'complete',policyId,baseline,controls}`;
`--reference` supplies the active `{baseline,repeat}` captures; `--capture`
supplies candidate capture (optional sole `confirmation`). Each capture has
`report` and `plan` entries. Existing `--baseline`, `--repeat`, `--report` must
match these bound raw captures. The stable checker and guarded activation require
all of them; absent/incomplete calibration cannot become a pass boolean.

`perf/check.mjs --initial-screen` explicitly reports an initial diagnostic screen
only. It cannot authorize activation. Normal checking requires complete bundles;
`--repeatability` remains a directional pair diagnostic, not method calibration.
No runtime/calibration collection is authorized merely by this documentation.
