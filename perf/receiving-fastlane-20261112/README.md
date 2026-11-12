# Receiving dev release — deployed 2026-11-12

Deployed successfully at 11:24:59 UTC as `ce8f5414e212bc7ac0f3ee01ec75d93812b298e96742f50f72a36a24bf4e10e3`. All 251 receiving tests, canonical TypeScript/build and live health/script checks passed. See `perf/REVIEW_QUEUE.md`; timing review is waiting. The command below is the historical invocation and must not be replayed against its now-existing output.

Originally prepared source-only during calibration. The user's2026-11-12 dev-lane
policy now authorizes deployment after own tests, canonical production type/build
and health checks; timing/byte findings are reviewed afterward. Root stopped and
marked interrupted calibration before runtime. Root prepared separate deploy and
validation trees. Own checks are recorded in checks-receipt.json. This proposal
alone neither switches a service nor grants production promotion.

Base is actual active wizard fastlane9aae/FP34f0c150, not rejected R20 or mutable
HEAD. Nine runtime files carry only commits4284faaf,5ae53190,3243df60 semantics:
short/missing quantities remain due without a blocking backorder decision;
Accept confirms read/match rather than full delivery; started-but-incomplete
orders show outstanding items; wrong-item labels are plain language.
Cancellation still needs correction; excess/invalid counts/wrong parts remain
blocked by existing logic. Existing evidence fingerprints and permission/server
checks are not removed. No service implementation, worker, migration/schema,
server flag, persistence, live stream or speed candidate is included.

## Composition and exact provenance

`manifest.json` records every selected commit/hunk's input/output/context hashes.
`runtime.patch` is active-based, with nine explicit postimages under `runtime/`.
Exact commit-parent matches permit direct hunks for receiving-resolution,
DeliveryTracker, MaterialListSheet and MaterialSectionHeading. OrderWaitingWarning
and order-waiting are the only new runtime files. Existing receiving quantity,
progress/completion, packing-slip types and dropdown primitives match requested
commit dependencies exactly.

MaterialListScreen and ReceivingWorkspace parents contain unrelated Phase1
changes, so their whole files were never copied. Every selected hunk's original
context matched the active-derived source exactly once, and only those hunks
were applied sequentially. Active ReceivingResolveContent does not exist: its
one option-label hunk maps exactly to original ReceivingResolve.tsx; no deferred
content split is imported. Commit324 labels follow the prior two commits. No
manual semantic expansion was necessary; all selected contexts matched once.

`validation.patch` and `validation-manifest.json` separately record six RC-only
test overlays, including the service integration test. They are not runtime
source overlays and do not authorize a DB run. No whole current test file was
substituted: active test bases plus exact selected hunks/new test were used.
Measurement owns `checks.md` with the required future isolated validation plan.

## Clean source preparation (now performed by root)

Preparation command template:

`node perf/receiving-fastlane-20261112/prepare-source.mjs /home/tim/.openclaw/workspace/releases/speed-phase0-receiving-rc-UNIQUE`

The preparer verifies active build/source fingerprint and all selected preimages,
refuses an existing destination, copies only named public release inputs, keeps
persistent server-only env/dependency references, pins .next to active9aae and
applies nine postimages. It verifies the exact full input delta, unchanged wizard,
and records new fingerprint operationally. It does not apply validation overlays,
copy private output trees, change a live pointer, build or activate. Root has now verified deploy fingerprint f6222405 and validation fingerprint bbd8764c.

## Explicit dev deployment

`node scripts/release/dev-deploy.mjs --source /home/tim/.openclaw/workspace/releases/speed-phase0-receiving-rc-20261112-dev1 --manifest perf/receiving-fastlane-20261112/manifest.json --checks perf/receiving-fastlane-20261112/checks-receipt.json --build /home/tim/.openclaw/workspace/releases/speed-phase0-receiving-rc-20261112-dev1/.next-web --agent speed_deployment --summary "Accept short deliveries and show outstanding material"`

The lock spans committed-merged provenance/own-test receipt validation, original
canonical recipe (production TypeScript required), retained files and packaging,
service-only restart, sign-in200/protected401/changed-script/SW byte checks and an
atomic newest-first review queue entry. Health or queue-write failure restores
the prior pointer/service. Durable attempt metadata preserves failure. No timing
matrix, baseline pair or byte ratchet blocks dev. Changed gzip bytes are review
metadata, not a gate. No worker bundle, migration/schema, org autopilot or data
deletion is included. Production promotion remains separate.

Merged cancellation correction3a777cc0 is included as one narrow guard: direct
Accept never overwrites an existing resolution; three regressions accompany it.
Runtime source fingerprint:
`f62224056be1245581c9a440a5777a921d8d36f3076e33156214ae78008785c3`.
Validation-only fingerprint:
`bbd8764c4de45d72e15ffa7798d3fbe4ee41914e246747f6a007716967484ed5`.
No latency or byte saving is claimed.
