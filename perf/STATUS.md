# Speed plan execution

Source plan: `perf/SPEED_PLAN.md`, copied unchanged from
`/home/tim/.openclaw/worktrees/foremanhq-ui/SPEED_PLAN.md`.
Its original plan-only header is superseded by Tim’s subsequent authorization.
Authorized by Tim on 2026-11-10, including Sol 6.1 delegation.

## Decisions recorded

- Start phases 0 and 1, using the plan's measured gates and one release recipe.
- Reference phone: Google Pixel 9 Pro XL with Chrome, confirmed by Tim.
- Production drawing sample reads and home-directory Rust setup: approved.
  Rust/cargo 1.99.0 are already installed; no replacement needed.
- Saved private last screen: wait for sign-in confirmation. A cold offline launch
  therefore cannot meet the pre-auth private-screen target; show the neutral gate.
- Extend existing Replicache when phase 2 is reached. Production schema changes
  are requested individually; the receiving worker release is a later decision.

## Verified foundations

- Server timing: 4 unit tests and 2 real PostgreSQL integration tests pass.
- Initial disposable main-schema seed created and cleaned up: 2 jobs, 25 parts,
  list/order/slip, chat, and 40 rendered synthetic drawing sheets. This was NOT
  a complete service schema: narrowed diagnostics found missing standalone
  `kublai_drawing_notification` (PostgreSQL 42P01). Pilot and partial full-run
  artifacts are fixture-schema-incomplete and are not accepted baselines.
  Lab export now includes standalone service schema modules from the exact
  selected release source; read-endpoint preflight is required before timings.
- Press audit: 1,408 JSX controls, including 246 raw buttons and 7 raw navigation
  handlers. The AST inventory uses conservative classifications, not automatic
  conversion of Accept, Delete, or money actions.
- Seven-day server journal inventory: 38,197 structured procedure observations.
  Background/device writes are separated from user-facing mutation candidates;
  QA traffic may be present.

## Current work

- Canonical builds, static-file retention and Brotli: implementation/proof in
  `scripts/release/README.md`. Existing script corpus saves 514,968 bytes (18.59%)
  with Brotli q11 compared with gzip q9. This is compression evidence, not proof
  of the under-100-KB deploy target.
- Account/build-scoped visited-route refresh and SuperJSON query persistence:
  prepared, conservative route/read allowlists, not a claim of every-screen
  coverage or measured under-100-ms navigation. Authentication stays authoritative.
- Client timing and `/api/perf` daily sink, performance budgets/journey driver,
  isolated application snapshot, actual journal usage inventory: in `perf/`.
- Database wait measurement preserves lazy queries and transaction clients.
  `Server-Timing` covers tRPC and Replicache responses. Streaming tRPC headers
  measure only work completed before headers; they explicitly say so. Complete
  procedure duration/database time remains in structured server logs. Streaming
  is not buffered merely to obtain a complete HTTP header.
- Disposable schema/seed and synthetic 40-sheet set: `perf/lab/database.sh`.
  PostgreSQL accepts only a private Unix socket. There is no production URL
  fallback. Constraints and indexes are retained. Clerk is stubbed only in the
  generated lab source tree, so authentication start-up cost needs separate
  field evidence. Lab snapshots carry a marker that the release builder rejects.
- Drawing spike: `perf/drawings/spike-report.json` covers 100 unique sheets
  across 50 active uploads. Median standalone PDF size is 348,236 bytes.
  Geometry/glyph/image components are not a complete format; quality comparisons
  expose missing images, state, forms and clipping. All four go gates remain
  unproven. No production renderer or worker switch. Private PDFs stay local.

## Gates still required

Phase 0 remains open until all target rows have real baselines and repeat runs
vary by less than 10%. The eight exact journeys need five runs on all three link
profiles, with 4x CPU slowdown. The physical reference phone, Safari, real field
INP, and sign-in startup are not replaced by desktop emulation or stub auth.

Do not activate unmeasured broad changes, label gates passed, or advance to a
production drawing compiler/offline receiving release without the plan's proof.
The first 20 instant writes must be selected from the recorded usage inventory,
with background calls excluded and external/destructive actions separately
reviewed. Server execution times are not tap-to-paint times.

## Live measurement bootstrap — 2026-11-11 00:38 UTC

Root activated the isolated Phase 0 telemetry/server-timing release. Root recorded health/sign-in 200 at origin and public edge, exact Brotli JavaScript bytes, successful byte checks for all ten retained historical samples, and service `NRestarts=0`. The web process uses the pinned release wrapper, canonical WorkingDirectory, separate worker mode, and a private numeric field-log directory. This starts collection from real usage; field phone baselines and the full speed gates are still open.

Phase 1 router/device-cache/update changes remain preparation only. Canonical
candidate builds and HTTP proofs have now run outside the lab quiet windows;
none has been activated. Cold private HTML caching remains disabled.

## Historical rejected pairs and early candidate — 2026-11-11

- The original two full `early-pinch-v1` captures each contain 120 samples, with
  passed read preflight and zero database errors. Repeatability failed one of
  24 cells: Site sheet opening/pinch moved from 973 to 1,432 ms median. Both raw
  captures remain archived. At that checkpoint there was no accepted full baseline.
- `ready-then-pinch-v2` explicitly waits for the initial sharp sheet before the
  same verified viewer pinch, charging both waits to the outer timer. Its
  calibration is a different method, not a repaired v1 result. The new frozen
  Phase 0 pair completed 240 samples with matching method/source bindings and
  zero database errors, but failed Basement material-list repeatability:
  203.9 → 229.0 ms (+12.35%). The other 23 cells passed. Both raw reports and
  recorded brief ADB setup overlaps are archived; no samples were excluded.
  At that checkpoint there was no accepted baseline; no cross-protocol improvement claim follows.
- The ten-minute isolated Jobs idle observation counted 80 background query
  reads and one stream request active at start/end with no observed reconnect
  or overlap. HTTP request lifetime does not establish heartbeat delivery,
  every-screen behavior, or a no-poll pass.
- The controlled Pixel attempt reached CDP setup but timed out on Page.navigate
  during lab attestation, completing zero physical timing samples. The latest
  three-journey local desktop smoke passed, proving adapter functionality only.
  Phone metadata, failure, local smoke, preflight and private-DB health are
  archived separately under artifacts/phone-visited-attempt-2026-11-11-*.
  The created phone tab was closed; forwarding was removed. The isolated phone
  server and its fresh private database were stopped and cleaned with no DB
  errors. No phone speed target or accepted v2 gate follows from this attempt.
- The reviewed candidate `ec687e6e…` passed canonical compilation, TypeScript
  and prerender. Its production output contains neither the development speed
  overlay string nor its module. All 282 current script/style assets passed
  exact compressed/decompressed HTTP checks; ten retained historical samples
  also matched. The generated public release manifest incorrectly redirects
  to sign-in; a narrow routing fix is prepared.
- That candidate fails the unchanged static ratchet: shared reference union
  502,618 → 508,465 gzip bytes; heaviest screen 758,531 → 778,612. The complete
  batch changes 1,236,327 gzip bytes, above the 100 KB target. The earlier
  controlled single-string edit changed 39,423 bytes; that separate proof does
  not turn the whole batch into a passing small deploy.
- The reference union includes conditional imports. A separate emitted entry
  graph comparison finds common jobs entry dependencies 449,264 → 451,435
  gzip bytes and receiving 701,916 → 707,126. These diagnostic figures do not
  replace the gate definition or its failed result. Further lazy-loading cuts
  and explicit cached-screen refresh behavior are being prepared.
- A bounded live service-journal sample contains 713 inventory-classified query
  completions: procedure p95 16 ms, summed database-time p95 10.6 ms. This is
  partial server evidence, excluding identity/context setup and serialization;
  it includes returned errors and possibly QA. It is not a full-request or
  repeatable read-latency gate. See
  `artifacts/server-read-observations-2026-11-10.json`.
- Tim confirmed Pixel 9 Pro XL/Chrome usage during the early field window.
  This is participant attribution, not a hardware fingerprint for each anonymous
  row or a controlled phone benchmark. Three early INP values and two materials
  navigation marks do not establish stable percentiles.

At this earlier checkpoint, the first-20 write step had six converted procedure/caller actions;
the later R4 section records the seventh partial photo-attachment slice.
Super Label has immediate progress/stop feedback without invented recognition
results. The shared live stream is a compatibility stage; 29 polling declarations
remain until producer coverage is proven. No production database change, worker
release, pre-auth private paint, full offline-convergence pass, or drawing
compiler rollout has occurred.

## Revised candidate and field checkpoint — 2026-11-11 04:22 UTC

R2 (`b1e2af3f…`) passes the unchanged **byte regression ratchets** against Phase 0:
shared gzip 502,618 → 485,100; heaviest route 758,531 → 755,290; full deployment
payload 2,734,731 → 1,260,984 bytes. This does not meet the final 120 KB/180 KB
script targets or prove a typical R2 edit stays below 100 KB. The 1.26 MB complete
batch is a different measurement from the earlier 39 KB controlled edit.
Canonical compilation/TypeScript and exact HTTP checks for 288 current assets
and ten historical samples pass; the public manifest now returns 200. No
activation: the full timing baseline and physical-phone evidence remain open.
See `artifacts/phase1-reviewed-r2-static-2026-11-11.json`.

A separate prepared change reduces the ready-page startup cover fade to 120 ms,
within the plan's 150 ms motion limit. It keeps the existing readiness and
sign-in boundary. Five existing handoff tests and scoped lint pass. It is not
part of R2, the frozen baseline, or the live bootstrap.

The refreshed anonymous field snapshot contains 60 beacons and 1,428 observations.
Twenty phone-class startup marks have a median of 808.5 ms; four INP observations
have a sample p75 of 104 ms; three navigation marks have a median of 593 ms.
These small, uncontrolled samples are not accepted physical reference gates.
The startup mark spans document navigation to cover removal, not an OS icon tap.
Hardware, link and repeat-visit conditions are not established per row, and the
live bootstrap still has its documented sampling/late-context limits. See
`artifacts/field-review-2026-11-10-2322.json`.

## R4 photo slice preparation

The seventh partial instant-write slice (owned-part photo attachment) is prepared, not activated. Exact R3 plus three reviewed photo production paths passed canonical webpack, production TypeScript and prerender after two narrow boundary/type fixes. Source verification and production overlay exclusion passed; all 288 current assets and ten historical URL samples matched exact bytes, manifest/health/sign-in returned 200, and unauthenticated cache binding remained 401. The proof server was stopped.

All three unchanged Phase 0 byte ratchets pass: 485,120 shared, 755,310 heaviest, and 1,273,448 deploy gzip bytes. Separately, the R3→R4 photo-feature payload changes 28/283 scripts (255 reused), totaling 283,891 gzip bytes and exceeding the 100,000-byte diagnostic. The distinct controlled R2→R3 edit still passes at 22,739 bytes/five scripts. Complete measured baseline/candidate and phone gates remain unaccepted; no activation. Metadata: `perf/artifacts/phase1-photo-r4-static-2026-11-11.json`.

## Accepted same-build v2 repeatability — 2026-11-11

The separate sealed v2 rerun has two complete 120-sample captures, all 24 cell
medians within the unchanged 10% band, matching source/method and zero private
database errors. The independent pair summary retains all original values and
stage occurrences without pooling or exclusions. Earlier four failed full
captures remain archived and rejected. This accepts desktop-emulated same-build
repeatability only. The later R6 candidate comparison below fails; there is no
physical-phone, full Phase 0 or activation claim. See `artifacts/baseline-ready-then-pinch-v2-rerun-2026-11-11-pair-summary.json`.


## Current measured candidate and supplemental evidence — 2026-11-11

The accepted sealed v2 baseline pair remains two complete 120-sample captures,
24/24 repeatability cells passing with the unchanged 10% threshold. Older failed
pairs and diagnostics remain intact. The full R6 candidate (`c49e8cba…`) has all
120 samples, exact source/method/preflight bindings and zero private DB errors,
but fails the original predeclared baseline-1 comparison: openjob Basement
82.44 → 98.70 ms and Office 82.27 → 98.68 ms. Site passes at 82.46 → 83.15 ms;
22/24 cells pass overall. Baseline 2 remains stability evidence, not a substitute
comparator. No waiver, sample replacement or activation follows. See
`artifacts/candidate-r6-ready-then-pinch-v2-2026-11-11-assessment.json`.

The separate 20-sample alternating baseline/R6 diagnostic passed every
hidden-destination-before-input precondition and observed actual pointer/click/
DOM-ready events. Browser pointerdown-to-DOM-ready medians were 11.0/10.8 ms
for baseline and 18.4/18.3 ms for R6 (Basement/Office). Driver/rAF alignment also
varied; no ≥50 ms long tasks were observed. These are real browser-local
readiness differences, not proof of a component cause, actual first paint, or
physical pixels. Instrumentation and two idle app servers add their own work;
desktop-UA sentinel history differs from Android CloseWatcher behavior. The
original openjob report has no app browser-stage marks because that workspace
transition uses local state rather than a pathname change. This supplemental
protocol neither retracts nor replaces its failed wallclock gate. All samples,
hashes, source/preflight/health and cleanup are archived in
`artifacts/openjob-phase-diagnostic-2026-11-11-assessment.json`.

The unchanged timing harness sets `NEXT_PUBLIC_BUILD_ID=isolated-speed-baseline`,
which is not a canonical 64-hex build ID. Production private service-worker
binding and `reloadReleaseOnce` branches are therefore not exercised by these
full matrices. Canonical source/static bindings remain verified; private Flight
cache and background-update release gates remain separate and unproven.

A distinct source-bound functional fixture passes 12 assertions using actual
provider/worker modules, valid-hex fixture builds and synthetic HttpOnly
loopback binding/read/Flight endpoints. It covers visited/tree scoping versus
prefetch, account/denial/logout fences, asset warmup and malformed manifest
rejection. It does not establish actual Next router/Flight compatibility, real
authentication, automatic quiet reload/chunk recovery, cold private HTML auth,
or performance. It does not fill the non-hex timing coverage gap by inference.
See `artifacts/private-cache-contract-r6-2026-11-11.json`. Separate actual-app
functional assertions must cite their own reports; neither protocol preparation
nor a partial result supplies the full release gate.

At that checkpoint no physical readings had completed. The earlier Pixel CDP attempt
timed out at Page.navigate before attestation; a later bounded check had no
usable Wi-Fi ADB advertisement, so no new physical run began. Uncontrolled,
participant-attributed field telemetry remains separate. None of this completes
Phase 0, twenty-run stability, every-frame sharpness or the final speed targets.


## R7 focused follow-up — 2026-11-11

The same instrumented v1 protocol completed 20 alternating Phase 0/R7 samples
with exact source/preflight identities, matching driver/preparation hashes and
zero private DB errors. All hidden-destination and input/readiness preconditions
passed. R7 click-to-DOM-ready medians were 8.9/9.0 ms versus baseline 9.0/9.3 ms
(Basement/Office). Driver totals were 76.07/95.64 ms versus 75.95/86.92 ms; Office
rAF alignment still varied. This is descriptive supplemental evidence, not
component causality, actual first paint or a full R7 regression pass. R6's full
gate remains failed; no reports, samples, metrics or thresholds were replaced.
See `artifacts/openjob-phase-diagnostic-r7-2026-11-11-assessment.json`.

Both private runtimes were cleaned after a bounded post-capture candidate hold.
The separate phone-v2 LOCAL smoke completed three samples and closed its owned
target with HTTP 200; it has `physicalPhoneEvidence: false` and is not a timing
gate. Its exact archive is
`artifacts/phone-v2-local-smoke-2026-11-11/report.json`. Those local checks supplied no physical readings; the non-hex timing-lab
private SW/reload coverage gap is unchanged. The subsequent separately authorized full R7 matrix is now archived and failed
as recorded below; the focused result did not replace its gate.


## Full R7 candidate result — 2026-11-11 08:05 UTC

The unchanged sealed v2 driver completed all 120 R7 samples against the
predeclared accepted baseline 1, retaining baseline 2 as stability evidence.
Exact source (`754be902…` / `42fcc8c7…`), compiled-artifact reuse, preflight,
method/wrapper/reuse-helper hashes and private DB health pass. The full gate
fails four cells: openjob Basement 82.4 → 98.5 ms, Site 82.5 → 99.0 ms, Office
82.3 → 98.8 ms, and Basement material-list 215.1 → 244.7 ms. The other 20 cells
pass. All samples and earlier R6/diagnostic failures remain intact, with no
waiver, selected retry, metric swap or threshold change. Original openjob
browser-stage arrays are empty, so the full report cannot attribute its delay
to action, rendering or frame scheduling. Separate instrumented diagnostics do
not replace this result.

Canonical static bounds are 485,406 shared, 755,594 heaviest, and 1,278,937 deploy
gzip bytes. Formal byte ratchets pass separately; final script/deploy targets
remain unmet. Ten-minute idle again records 80 query-procedure reads and three
stream starts/two closes without overlap; this is not a no-poll or continuous
heartbeat pass. At that checkpoint the non-hex lab private SW/reload gap and controlled
physical zero remained unchanged. Server and private DB were cleaned with zero errors;
no further full run or activation is queued. Raw/provenance/assessment:
`artifacts/candidate-r7-ready-then-pinch-v2-2026-11-11-assessment.json`.


## Supplemental actionability comparison — 2026-11-11

Twenty Office samples compare baseline/R7 × default/force × five with balanced
order, exact frozen visited preparation and the same first job-name target and
point algorithm. Added guards verified unique visible/enabled interactive-card
ancestry, hidden destination, and trusted target input followed by DOM readiness.
Browser request-to-pointer medians were 33.3 → 7.8 ms for baseline and
36.2 → 8.1 ms for R7 (default → force). Click-to-DOM-ready was 9.3 ms default and
9.1 ms force for both sources; R7 pointerdown-to-click still exceeded baseline.

Force skips several page/state/hit-target/interception checks, not just stable
rAF waiting. Scrolling, point computation, actual input and navigation/next-task
waits remain. Faster force mode does not invalidate default clicks, identify a
component cause or replace the failed full gate. Additional guards/probes alter
phase alignment, so these medians cannot substitute for frozen gate timings.
All 20 samples, source/preflight/health and driver hashes are archived; both
private runtimes were cleaned with zero errors. The executed driver is
`29b9f51d…`; the earlier prepared frozen copy was never executed and is labeled
separately. See
`artifacts/openjob-actionability-diagnostic-2026-11-11-assessment.json`.


## Controlled R7/R8 press comparison — 2026-11-11

The exact three-file attribute-feedback patch was compared in 40 Office samples
(20 per source), using eight balanced five-sample blocks through the original
sealed default-click driver. No continuous observers, forced clicks or added
in-timer probes were used. Both source/preflight identities, the three changed
production paths, coordinator/method hashes and zero private DB errors passed;
all raw fragments remain intact and both private runtimes were cleaned.

Nearest-rank medians were R7 93.01 ms and R8 90.72 ms, with overlapping IQRs
[88.57, 97.51] and [86.06, 95.28]. Paired-block R8-minus-R7 median differences
were −5.15, +3.34, +0.28 and −8.78 ms: two lower and two higher. This mixed,
roughly 2 ms result does not show a consistent one-frame benefit or establish a
component cause. A fresh browser per block is an untimed supplemental difference
from the full matrix. No R8 full matrix is approved or queued; the unchanged R7
four-cell failure remains authoritative. See
`artifacts/openjob-press-r7-r8-comparison-2026-11-11-assessment.json`.

## Release and reference-device checkpoint — 2026-11-11 08:55 UTC

R8 passed canonical compilation, source binding, formal Phase0 byte ratchets,
and HTTP/Brotli checks for 288 current assets plus ten historical samples. The
strict 100 KB changed-script target separately failed: 279,829 gzip bytes changed
despite only 2,723 bytes of net growth. The shared press hook is copied into 26
output chunks with unchanged membership; this is not framework churn. See
`artifacts/phase1-press-r8-static-2026-11-11.json` and the adjacent chunk-churn
report. The controlled timing result above does not justify a new full matrix.

`measurement-definition-audit.md` separates the frozen automation end-to-end
metric from a prospective browser-input-to-ready/paint-opportunity metric. No
definition, threshold, old result or release gate changed. A future metric would
require its own complete calibration and repeatability evidence.

At 08:55 UTC the paired reference Pixel was absent from ADB and did not advertise
wireless debugging. No valid physical timing samples have been collected. The
live `.next` target remains the Phase0 bootstrap; no candidate activation,
production database change or receiving-worker release occurred.


## Partial Pixel session and user deferral — 2026-11-11

The root-owned Pixel session used one fresh source-attested synthetic R7 app,
with 14 real read checks, copied schema/fixture metadata and zero final DB
errors. Methods and failures are separate: physical v2 completed one openjob
observation (60 ms), then repeat source readiness timed out; local desktop v3
completed four observations before material-list warm readiness failed;
physical v3 completed zero; physical v4 completed two openjob observations
(46.9/46.2 ms), then tab warm readiness timed out. Each intended six-read
protocol failed. Raw aggregate flags remain `physicalPhoneEvidence: false` and
`accepted: false`; do not pool these methods or infer percentiles, improvements
or an accepted physical gate. Browser DOM/rAF readings are not physical pixels.

All frozen method bytes/before hashes, reports/logs, selected loopback inputs,
preflight/source/schema/synthetic fixtures and exact copy hashes are archived
under `artifacts/pixel-r7-physical-session-2026-11-11/`. The root's physical
launcher was inline and not independently frozen; no helper provenance was
invented. All owned targets closed with HTTP 200, forwarding was removed, and
the private app/PG/timer were cleaned. The user cannot keep Pixel open and
explicitly requested moving on: further phone work is deferred. The proposed
local-only v5 follow-up was cancelled before setup/runtime, with zero samples.
No acceptance/full matrix or deployment follows from this session.

## Independent Phase 1 work after phone deferral — 2026-11-11

Phone work remains deferred at Tim's request. Independent source preparation
continues; the live build remains the Phase 0 bootstrap and the R7 four-cell
journey failure is unchanged.

The global drawing-cleanup split (`035e61f8`) and optional voice-engine split
(`77373c58`) have separate exact canonical snapshots R9 and R10. Together their
supplemental common initial dependency union falls from R7 431,270 to R10 417,476
gzip bytes (13,794 fewer). R10 canonical compile, production TypeScript and
prerender pass; formal shared/heaviest metrics are 473,958/749,234 bytes, still
above the eventual 120,000/180,000 targets. The strict changed-script payload
also fails separately: R7→R9 549,936 bytes and R9→R10 157,682 bytes, both above
100,000. Neither byte experiment ran HTTP/journey/idle checks or activation.
See `artifacts/phase1-cleanup-r9-byte-2026-11-11.json` and
`artifacts/phase1-voice-r10-byte-2026-11-11.json`. R8's unproven press variant is
excluded from both frozen snapshots.

Additional source slices, not part of those byte builds:

- Drawing folder creation (`f7112319`): visible pending name, duplicate/offline
  guards, actor/read-authority fencing and refused-draft recovery; real server
  IDs only. 74 focused tests pass.
- Material-sort realtime (`168502f8`): transactionally committed identifiers-only
  hints, account-scoped delivery, coalesced reconnect/visibility catch-up. 38
  focused tests and a private PostgreSQL cross-process rollback/reconnect proof
  pass. Follow-up `bd02918b` conditionally suppresses that one 60-second poll
  only with verified listener health, an authoritative settings catch-up and
  fresh matching results from the already-shared role query. It adds no role
  request/observer or Clerk polling. Listener loss, stale authority, resume or
  unsupported driver lifecycle restores fallback. 78 focused tests plus a real
  private-PG kill/reconnect proof pass; browser idle savings and compiled runtime
  behavior remain unmeasured. All other polling sites remain unchanged. See
  `live/material-sort-authority.md`.
- Member save feedback (`326aed65`, `7f8ca0f6`, `88f9a2c4`): visible pending
  and authoritative-refresh phases, duplicate/offline guard, retained draft,
  bounded read-only recovery after uncertain outcomes, and an actor guard. 40 focused
  tests pass; no local permission grant. See `instant-writes-member-save.md`.
- Bulk receiving feedback (`9530aaab`): pending quantities message with existing
  receipt locks preserved; footer motion is 150 ms without delayed entrance.
  Action-bar and existing receipt-hook checks pass 22 tests. No invented totals.
- Source laws (`27d2ddd5`, `60b1d800`): lint and canonical build preflight reject
  new/changed recognized raw navigation and new shared-layout providers, against
  precise reviewed baseline entries. The 22 tooling tests and unchanged frozen
  R8 source checks pass. Coverage limits and provider retirement requirements
  are documented in `scripts/navigation/README.md` and
  `scripts/layout/README.md`; no blanket polling ban was introduced.

These focused checks do not complete the first-twenty latency target, all-screen
cache coverage, no-poll idle gate, physical-phone measurements or Phase 0. No
production database change, worker release or phase-two sync rollout occurred.

## Combined R11 and later focused fixes — 2026-11-11

R11 combines the reviewed R10 source with thirteen exact commit groups, including
the preference authority, folder/member/bulk feedback and source-law changes.
Every intermediate parent and final source hash matches; unrelated dirty files,
the R8 press experiment, schema and worker executable remain excluded. Canonical
webpack, production TypeScript, prerender and both source preflights pass.
Build `ae52a68d…` has shared/heaviest/deploy gzip metrics of
477,954 / 757,796 / 1,293,940, passing the original Phase0 byte ratchets. The
heaviest screen has only 735 bytes of headroom. Strict R10→R11 changed scripts
total 441,018 bytes, still above the separate 100 KB target. This is a combined
feature batch, not a typical single-leaf edit. No matching HTTP, idle, full
journey matrix or activation is claimed. See
`artifacts/phase1-combined-r11-byte-2026-11-11.json`.

The supplemental material-list CPU profiles completed for Phase0/R6 in v4 and
v5, preserved separately with raw evidence and cleanup records. V5 replaces an
expensive diagnostic readiness observer with a latched first-control check;
observer overhead drops from about 48 to 8 ms because the measurement method
changed. The one R6 capture has about 8.5 ms more work in a React callback region,
but sampled module weights overlap and do not establish a component cause.
Neither diagnostic changes the acceptance metric or earlier failed matrices.
See `artifacts/material-list-cpu-diagnostic-2026-11-11-attempt5/README.md`.

Later prepared source, excluded from R11:

- Ordinary unsent material rows (`49e911d3`) skip receipt-only hooks through a
  separate component. Sent/receiving rows keep the original controller; shared
  stateless presentation prevents duplicated card markup. 39 focused tests
  pass. Elided hook registrations are source counts, not measured milliseconds.
- Merge feedback (`3c322416`, `1a1d88a4`) requests accepted-result sync immediately
  instead of awaiting a 500 ms animation. Both optional animations take 150 ms;
  late responses cannot revive an unmounted view. 15 focused tests pass.
- Snapshot portal tracking (`9970d723`) stops its whole-body observer while the
  feature is closed and resolves the current fullscreen host before reopening
  controls paint. 14 focused tests pass; no timing improvement is asserted.

Drawing-scale acknowledgement races and on-demand comparison loading are still
being validated as later slices. Phone work stays deferred; no schema, worker,
production data write or candidate activation occurred at this checkpoint.

## R12 build and continued work without the phone — 2026-11-11

The user deferred the unreliable Pixel connection. Physical measurements remain
unproved; independent source and isolated lab work continue.

R12 (`d18cbd7b…`, fingerprint `f8aea064…`) adds the seven reviewed groups to exact
R11: ordinary-row partition, merge feedback/unmount fencing, idle snapshot
observer, lazy comparison/shared controls, and the tested scale acknowledgement
path. Twelve runtime files changed; all 5,456 unaffected inputs and 3,263 public
files match. Canonical compilation, production TypeScript, prerender and source
laws pass first try. Shared/heaviest gzip metrics are 478,116 / 640,641; receiving
is 117,155 bytes smaller than R11 by the unchanged formal metric. All original
Phase0 byte ratchets pass. Strict R11→R12 changed-script payload is 541,833 bytes
(39 of 287 scripts changed), still above 100,000. The final shared/heaviest
targets remain unmet. No timing improvement or activation follows from these
byte results. See `artifacts/phase1-combined-r12-byte-2026-11-11.json`.

The exact isolated R12 lab compile also completed. Its first supplemental
preference-stream check stopped on a test observer defect: real tRPC JSONL
responses carry application/json, so response content type alone selected the
wrong decoder. No assertion passed; the private database had zero errors and
all processes/ports were cleaned. That failed run is preserved separately. The
observer is being corrected against the actual request protocol before another
functional attempt. The frozen timing method and earlier failed matrices remain
unchanged; no R12 full matrix has run at this checkpoint.

Two later slices are committed and explicitly excluded from R12:

- Chat join (`d434e254`): immediate pending latch, dispatch-time connectivity and
  authority checks, no paused replay, scoped late responses, and a bounded
  membership read after an uncertain result. Real overview authority still gates
  history/composer. 52 focused tests pass; scoped lint adds no findings.
- Catalogue creation (`3a814154`): one explicit request with an actor guard and
  synchronous duplicate latch. The actual supplier-link ID travels in the create
  response, removing a second lookup after acceptance. Drafts survive uncertain
  outcomes; real ACK completion cannot be held by refresh or lost on a same-form
  connectivity change. 44 focused tests pass, with existing lint unchanged.

These are prepared improvements, not completed first-twenty latency, no-poll,
offline-convergence or deployment gates. No production schema or worker release.

## R14 compiled runtime and delivery checks — 2026-11-11

R13 includes the reviewed chat-join, catalogue-creation and timesheet-hint slices.
The timesheet hints use the existing shared stream and transactional notifications;
the existing authority/context poll remains. No poll-removal claim follows.
Canonical compilation passed, but inspecting the actual server output found a
native module resolver defect that the earlier minimal webpack fixture missed.
R12 had compiled the package path into a numeric module ID; the first R13 fix
instead left an unbound named import. Both failures are preserved. The corrected
fixture now reproduces the R13 failure and checks the namespace-based fix.

R14 (`a5c2aa0b…`, fingerprint `6f5dfb96…`) changes only that resolver from exact
R13. Canonical production compilation, TypeScript, prerender and source laws
pass. The actual emitted resolver finds the pinned Postgres 3.4.8 package, and
the private compiled app subsequently establishes its shared LISTEN stream.
Shared/heaviest gzip metrics are 478,139 / 640,663. All Phase0 byte ratchets pass;
the eventual 120,000 / 180,000 targets remain unmet. This single server edit
changes 20,570 gzip bytes, passing the strict 100,000-byte update target. It does
not waive earlier combined-batch failures. See
`artifacts/phase1-native-r14-proof-2026-11-11.json`.

Matching HTTP checks pass for all 292 current JS/CSS assets and ten retained
build samples: exact Brotli sidecars, decoded bytes and immutable headers.
Packaged service-worker bytes match; release manifest, health and sign-in return
200, and unauthenticated private binding returns 401. Database read-only mode
was enforced and verified. The first host-binding fixture failure is preserved;
the corrected localhost attempt passed and all owned runtime resources closed.
See `artifacts/phase1-r14-http-proof-2026-11-11.json`.

The first R14 supplemental preference protocol passed four actual checks:
compiled stream readiness with authoritative controls, a 75-second healthy
interval without preference polling, a second-session update delivered through
the shared stream and HTTP catch-up, and permission expiry revoking executive
controls. It then failed an assertion requiring the restored control's label
to be “Edit executive sorting.” Source retains the earlier open-editor state,
which can instead label that control “Close executive settings.” Restored role
HTTP granted access, but the failed run captured no alternative-label UI proof:
it remains failed, with no retrospective restoration pass. Outage and LISTEN
recovery stages were not reached. Database errors were zero and cleanup passed.
See `artifacts/r14-preferences-functional-2026-11-11-attempt1/`.

The supplemental UI observer is being corrected against the two real labels;
the frozen timing method is unchanged. The full R14 journey matrix remains held
until the complete functional protocol passes. Production remains the Phase0
bootstrap. No phone work, production schema change, worker release or candidate
activation occurred.

## Complete R14 stream check and subsequent fixes — 2026-11-11

The separately frozen V5 supplemental run passed all eight intended checks,
including fresh HTTP restoration, fallback polling during a stream outage,
transport reconnection, and an actual private LISTEN termination/resubscription.
There were zero unexpected database errors and exactly one expected termination;
all owned processes, ports and private database files were cleaned. The original
V4 failure remains archived. V5 is functional evidence, not the frozen timing
matrix or a no-polls claim. See
`artifacts/r14-preferences-functional-2026-11-11-attempt2/`.

Its denial snapshot also exposed a real additional defect: the open executive
editor stayed enabled after permission loss. A provider regression reproduced
an attempted executive edit falling through to a personal save when personal
sorting was enabled. Later source `adda6fbd` preserves the selected write target,
makes that editor read-only and retains the separate personal choice. All 33
focused tests pass, and scoped lint adds no findings. The stronger V6 protocol
is frozen separately and unexecuted, requiring the denied editor to be disabled.
R14 has this known UI defect, so its full timing matrix was not started.

Existing-own shared drawing issue saves are hardened in `c38c454c`. Accepted
responses finish without waiting for refresh; newer cached revisions win; scoped
duplicate/late-response guards and per-issue read-only recovery preserve drafts
after uncertain responses. The server's optional account guard runs before the
existing save service. Private queues and other save kinds retain their prior
paths. All 131 focused tests pass, with no added lint findings. These changes
and the receiving-resolution loading boundary will form the next reviewed
candidate, rather than modifying frozen R14.

The isolated drawing prototype now replays bounded ordinary RGB/RGBA image
resources, with deduplication and explicit unsupported cases. Thirteen synthetic
tests and scoped types pass. One existing private sample was rendered at the
two existing widths and visually inspected: its image replay is eligible, but
full-sheet fidelity fails both widths because other rendering semantics remain
incomplete. This is not a sample-wide fidelity or compression result. Historical
100-sheet evidence is unchanged, no production drawing path changed, and no
runtime remains. See `drawings/image-replay-one-sample.json`.

## R17 passes compiled correctness; full timing in progress — 2026-11-11

Receiving resolution now loads only after selection (`0bab2c39`). Its controller
and linking helper are unchanged; Close remains available while loading and an
import failure can be retried without resetting a mounted editor. All 136 focused
tests pass. This slice, executive-editor protection and shared-issue saving were
composed into exact snapshots, excluding unrelated working changes and R8.

The R15 and R16 builds failed production types and remain preserved. Follow-ups
`9cbe46d7` and `ecfa51dc` correct the nullable caller boundary and remove a deeper
error: workspace revisions are optional content hashes, not ordered counters.
Recovery now compares only numeric entity revisions; a missing target preserves
the cached issue and blocks another save pending authoritative reconciliation.
The corrected hook and Workspace pass 127 focused tests. A complete isolated
no-emit comparison finds zero production diagnostics and no new diagnostics
against R14; 1,975 inherited test-only diagnostics are unchanged. Canonical
production checking uses Next's existing test/spec filtering, with no config
exception added for this work.

R17 (`b1c2adf3…`, fingerprint `be7f2350…`, 2,316 source inputs) passes canonical
webpack, production TypeScript, prerender and source laws. Shared/heaviest gzip
metrics are 478,165 / 627,389, passing the Phase0 ratchets but not the eventual
120,000 / 180,000 targets. Receiving is 13,274 bytes smaller than R14 and 131,142
smaller than Phase0 under the unchanged manifest metric. Strict R14→R17 changed
scripts total 370,555 gzip bytes: this combined batch fails 100,000. No waiver or
actual-browser-download claim follows. The native resolver still passes.
See `artifacts/phase1-r17-build-proof-2026-11-11.json`.

All 293 current assets and ten actual retained live-build samples pass exact
Brotli/decoded-byte HTTP checks; packaged worker and public endpoints match,
and unauthenticated private binding remains 401. The first historical sample
selection incorrectly used an unactivated candidate and is preserved separately;
the corrected samples come from the actual retained live chain. Database
read-only mode was enforced, and the proof server closed cleanly. See
`artifacts/phase1-r17-http-proof-2026-11-11.json`.

The separately compiled private app also passes all eight V6 functional checks,
including the newly required disabled executive editor during permission loss.
It records zero unexpected database errors, one intentional LISTEN termination,
unchanged method hashes and complete cleanup. See
`artifacts/r17-preferences-functional-2026-11-11-attempt1/`.

One full R17 capture is now running on a new private database: the original
ten-minute idle check and 120 samples, unchanged frozen v2 timing method and
predeclared baseline-1 comparator. No result, timing improvement or activation
is yet claimed. Builds, other heavy checks and phone work are stopped during
this measurement window. Production remains the Phase0 bootstrap.
