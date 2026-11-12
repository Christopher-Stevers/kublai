# Speed plan execution

Source plan: `perf/SPEED_PLAN.md`, copied unchanged from
`/home/tim/.openclaw/worktrees/foremanhq-ui/SPEED_PLAN.md`.
Its original plan-only header is superseded by Tim’s subsequent authorization.
Authorized by Tim on 2026-11-10, including Sol 6.1 delegation.

## Current checkpoint — 2026-11-12

The work is in Phase 1 preparation; no broad Phase 1 candidate has passed the
release gate. Production runs the Phase 0 measurement bootstrap plus the approved
one-file catalogue wizard fix (`9aaeabbe…355b0`), activated only after all fastlane
gates passed. Its full matrix passes 24/24 cells, and its update is 33,690 gzip
bytes. No broad Phase 1 changes were included. Phase 0 has a working synthetic lab, repeatable
desktop baselines and live telemetry, but controlled phone/Safari and remaining
field targets are unproved. Tim deferred further Pixel debugging; independent
work continues without requesting that connection again.

The latest broad Phase 1 candidate (R20) passed 23 of 24 timing cells and was not
activated. Opening a job on the Basement profile measured 98.4 ms against the
82.4 ms baseline, exceeding the unchanged 10% regression band. The newer receiving/photo source passes focused checks and canonical
compilation/byte ratchets, but has no new full timing result. Its shared script is
478,853 gzip bytes versus the 120 KB target; its R19-relative update is 445,298
bytes versus the 100 KB target. Tested source is not a claim of live improvement.

Phase 2 has an audited and tested existing Replicache contract; new offline job,
receiving and chat domains remain unimplemented. The Phase 3 drawing spike failed
visual fidelity, so its production compiler is stopped and today's renderer is
retained. This is an observed stop decision, not a completed drawing workstream.

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

## R17 full capture rejected for launcher protocol error — 2026-11-11

The capture completed all 120 samples and the original ten-minute idle window,
with 14 source-bound read checks and zero database errors. The launcher omitted
`PERF_SHEET_PROTOCOL=ready-then-pinch-v2`, so the unchanged adapter used its
`early-pinch-v1` default. The report correctly records that older protocol; the
formal comparator rejected it before comparing timing cells. All raw results
remain preserved. They cannot support a v2 improvement, regression or release.
This was an orchestration/review error, not an application benchmark pass.
See `artifacts/candidate-r17-incompatible-early-pinch-v1-2026-11-11/`.

The independent idle count is 74 query reads versus the earlier baseline's 80;
there was at most one `/api/live` request at a time. This is one Jobs screen,
not the no-poll gate or a general delivery claim. The full report embeds its
actual source-bound schema counts; a standalone inventory was not copied before
the private database was removed. All owned runtime was cleaned.

A corrected launch is being prepared with an explicit protocol export, a
pre-database guard against the declared baseline, and complete per-run schema
archiving. The frozen timing code, baseline, thresholds and failed records stay
unchanged. No second capture has started at this checkpoint. Independent source
validation has resumed; production remains the Phase0 bootstrap.

## Corrected comparison running; isolated follow-ups verified — 2026-11-11

A separate R17 attempt2 has started against the same frozen candidate, v2 method
and original baseline. Explicit protocol guards passed before database startup
and idle observation; all 14 read preflights passed on its fresh private fixture.
This run preserves its own schema/source/fixture evidence before cleanup. Ten
database-free protocol/cleanup checks passed, including failed-copy propagation.
The original incompatible capture is unchanged; no timing result is claimed for
the running corrected attempt. Other heavy work is stopped again.

The later snapshot presentation split (`13fcfeed`) passes 19 focused tests,
including delayed import, retry, captured draft retention and keyed replacement.
Selection focus and capture initiation stay in the eager controller. Isolated
R17-versus-overlay types show zero production/owned errors or new diagnostics;
existing image lint warnings are unchanged. This source is excluded from R17
and has not been built or measured for byte savings.

The isolated drawing prototype now combines existing glyph/image replay and
bounded forms. A subsequent source-proven correction defers clipping until the
intended packed path is consumed. All 22 focused tests and scoped types pass.
One separately versioned render of the same sample restores the main geometry,
but full-sheet fidelity still fails at both widths (minimum tile SSIM about
0.407/0.460, below 0.98). Both reference/prototype pairs were inspected; source
hashes match and prior reports are unchanged. No production renderer, worker or
Rust compiler was changed. Known stroke/hairline and graphics-state style gaps
are documented as source findings, not another measured pass.

A source-artifact audit also finds 118,373 existing gzip bytes in R17's four
framework/root-main files, out of 478,165 formal shared bytes. That leaves just
1,627 bytes for everything else under the final 120,000-byte total target with
this exact root graph. UI splits alone cannot establish that target. This is
existing file-size/membership evidence, not a new transfer timing, a claim that
all smaller framework builds are impossible, or permission to exclude framework
bytes from the budget. See `artifacts/phase1-r17-framework-budget-2026-11-11.json`.

## Corrected R17 full comparison fails two cells — 2026-11-11 14:40 UTC

The explicitly guarded v2 attempt2 completed all 120 samples against the original
baseline-1 comparator. Root independently rechecked report validity and baseline
repeatability: both pass. The unchanged regression comparison fails opening a
job on Site (82.46 → 98.33 ms) and Office (82.27 → 98.52 ms); the other 22 cells
pass. No retries, exclusions, alternate comparator or threshold change follows.
R17 is not eligible for activation; production remains the Phase0 bootstrap.

This run preserves its actual 16-module/113-table schema, all 14 successful read
preflights, zero PostgreSQL errors, exact source/method/environment verification
and all raw samples. The ten-minute idle window counted 74 query reads and at
most one live request, not a no-polls pass. Owned browser/server/database work
was cleaned before releasing the quiet window. See
`artifacts/candidate-r17-ready-then-pinch-v2-attempt2-2026-11-11/`. The earlier
incompatible-protocol R17 capture remains separate and rejected.

Independent work continues: a narrow usePress chunk-extraction experiment passes
four configuration tests and has a bounded three-build proof authorized against
exact R17, excluding Snapshot and unrelated checkout changes. No byte saving is
yet measured for this experiment. A source-grounded existing Replicache contract
is now recorded in `replicache-existing-contract.md`; it changes no runtime and
is not Phase2 implementation or convergence proof. The Pixel remains deferred.

## R18 build and HTTP pass; isolated existing sync verified — 2026-11-11

The controlled usePress extraction reduces the identical emitted small edit from
216,161 to 24,505 changed gzip bytes and 25 physical allocations to one. It also
changes other chunk placement, including Button allocations from 25 to 33. Its
standalone configuration grows the heaviest screen by 327 bytes, so that corner
remains held. The migration is distinct from the controlled edit; every outcome
is preserved in `artifacts/use-press-four-corner-2026-11-11/`.

R18 composes exactly five reviewed runtime paths on frozen R17: that configuration,
deferred snapshot controls, removal of one discarded open-job preparation read,
and bounded transactional retained-panel bookkeeping. The latter's Profiler
regression fails the old nested commit and passes the new single update; eleven
Activity/integration tests and six registry tests pass. These establish concrete
work removal, not a production latency amount or the cause of R17's failed cells.

The canonical R18 build passes compilation/types/prerender with source fingerprint
`ec149c2e…` and build `c58613f1…`. Shared/heaviest gzip are 476,958 / 627,137,
both lower than R17; Phase0 static ratchets also pass. The full R17→R18 batch is
598,793 changed gzip bytes, still above 100,000. No waiver, final-target pass or
browser-download claim follows. All 293 current HTTP assets, ten actual retained
historical samples, packaged SW and unauthenticated endpoint checks pass; the
read-only proof server stopped cleanly. A new private lab compiles and passes
all fourteen read checks. The unchanged V6 compiled behavior check is now running
on a separate fresh fixture. No full R18 timing or activation has occurred.

Existing Replicache contract assertions also pass on an independent disposable
R17-bound database, reporting sixteen pull checkpoints and zero PG errors. The
first runner attempt failed before its first fixture insert because the driver
ignored URL query host/port; it remains recorded. The corrected guard inspects
the actual application client's socket options before SQL and verifies the same
client's database/data-directory identity in a read-only transaction. Fifteen
database-free guard/cleanup tests pass; actual logs were preserved after shutdown
and the owned database was removed. This verifies existing server behavior only,
not Phase2 domains, three-device convergence or live transport. See
`artifacts/replicache-isolated-attempt2-2026-11-11.json`.

Production remains the Phase0 bootstrap. Pixel work stays deferred as requested.

## R18 functional checks pass; full comparison running — 2026-11-11 15:15 UTC

All eight unchanged V6 functional checks pass on R18's separately compiled
private app, including fresh HTTP authority, disabled editing after permission
loss, fallback polling during a stream outage, and actual LISTEN recovery.
There are zero unexpected database errors and one intentional listener
termination. The actual schema, logs and method/source hashes are archived in
`artifacts/r18-preferences-functional-2026-11-11-attempt1/`; all owned runtime
was cleaned before the timing run.

The full comparison now runs once against the original baseline-1 and frozen
`ready-then-pinch-v2` method: ten minutes idle, then 120 samples. Its launcher
explicitly checks the protocol before database startup and before capture.
All fourteen actual read preflights passed on the new fixture. Sixteen
database-free protocol/exit checks verify that failed evidence copies or cleanup
propagate a failing exit status. Preparation and exact command hashes are in
`artifacts/candidate-r18-ready-then-pinch-v2-2026-11-11-preparation/`.

No full timing result, acceptance or activation is claimed while this run is in
progress. Other builds, tests and browser/database work are stopped to preserve
the measurement window. Source-only reviews continue; the Pixel remains deferred.

## R18 full comparison rejected; existing sync checks expanded — 2026-11-11

R18 completed all 120 samples under the unchanged v2 method. Root independently
validated the report, baseline repeatability and comparison: 23 of 24 cells
pass. Office quantity editing fails at 132.09 ms versus the original 114.14 ms
baseline (+15.73%, above the 10% allowance). All three opening-a-job cells now
pass. The failed result is preserved, with no retries, exclusions, alternate
comparator or threshold changes. R18 is not eligible for activation.

Its actual source-bound schema, fourteen successful preflights, zero PostgreSQL
errors, unchanged method/environment/source and clean teardown are archived in
`artifacts/candidate-r18-ready-then-pinch-v2-2026-11-11/`. The ten-minute idle count
is 74 reads, with at most one live request. Production remains the Phase0 build.

The retained Office quantity write-to-paint marks have medians near 21 ms across
both baselines, R17 and R18, while the outer scripted interaction rises. Those
marks measure two animation-frame opportunities from the application handler;
the outer timer also includes automation, actionability and assertions. They
are not disjoint phases and cannot be subtracted or used to waive the failure.
Source inspection finds no introduced wait in the unchanged quantity handler.
See `quantity-office-evidence-audit-2026-11-11.md`; a narrow supplemental trace
is being prepared, not run or accepted as another gate capture.

The existing Replicache contract now has a separate actual-database check against
frozen R18. All five added cases pass: a gap in one client's sequence rolls back
the whole batch and both cursors; a changed duplicate payload is skipped;
permission denial acknowledges without applying; an obsolete name does not block
the next write; and a hard input-validation failure rolls back earlier writes
and cursors. Nineteen no-database guard/selection/cleanup tests, syntax and scoped
types also pass. The actual application client was bound to the private socket
before SQL, source hashes stayed exact, PostgreSQL logged zero errors, and the
final log was copied after shutdown before removal. This is existing-handler
evidence, not real authentication, browser replay, new domains or convergence.

A separate small JobsClient badge follow-up (`51b43717`) now refreshes cached
job-chat counts behind the visible badge on active revisit/resume. It preserves
the 30-second fallback and adds no persisted history or permission grant.
Thirteen focused tests and scoped lint pass. It is excluded from R18 and is
not activated. Receiving saved-read and the 13-mutator interface boundaries are
documented in `receiving-saved-read-audit.md` and
`replicache-interface-preparation.md`; both remain preparation only.

## R19 source frozen; quantity press feedback prepared — 2026-11-11

The quantity step buttons now opt into visual attribute feedback, removing the
two React commits previously used only for press highlighting. The measured
Profiler test reports zero feedback commits for this opt-in; 35 focused tests
across six files cover the default behavior, quantity controls and gesture/save
regressions. Activation stays on release and the existing local/durable save
path is unchanged. This proves work removal, not a latency amount or the cause
of R18's failed Office cell. Source commit: `d5f30d71`.

R19 is an exact R18 copy plus four reviewed runtime files: the hook-only
attribute feature, Button prop, quantity opt-ins and job-chat badge refresh.
Root independently recomputed both source fingerprints and the exact four-path
difference. The R8 job-card opt-in remains excluded. Fingerprint `4541b37e…`;
manifest `artifacts/phase1-combined-r19-source-freeze-2026-11-11.json`. No build
or activation has occurred at this checkpoint.

A separate two-operation R17/R18 quantity trace is prepared to inspect input
and field-update timing. Its instrumentation has three passing fixture tests;
setup/process cleanup review is still pending. It is supplemental only and
cannot replace the failed full gate. Production and the original v2 comparator
remain unchanged; Pixel testing stays deferred.

## R19 canonical pass; bounded diagnostic running — 2026-11-11

R19 build `47b6e705…` passes production compilation, TypeScript, prerender and
source laws. Formal shared/heaviest gzip are 477,538 / 627,737; both remain below
Phase0, but rise 580 / 600 bytes versus R18. Its complete R18→R19 batch changes
42 of 288 scripts, 334,721 gzip bytes, so the strict 100 KB diagnostic fails.
Every one of 293 current assets has exact Brotli/gzip sidecars; all 1,120 active
raw historical assets and 3,263 public snapshot files match. Native PostgreSQL
metadata resolution passes. Build proof: `ba062b84`; HTTP/full timing pending.

The separate one-attempt quantity diagnostic is now running from the frozen
method in `artifacts/quantity-office-diagnostic-preparation-2026-11-11/`.
It allows exactly one operation on R17 then R18, with two fresh private fixtures,
short instrumented captures and bounded process ownership cleanup. Its added
profiling, geometry and process-monitor work mean it cannot replace acceptance
timings or establish a causal performance delta by itself. No retry is queued.

A receiving-cache prerequisite is prepared in `9ace848a`: protected snapshots
compare account and per-key epochs atomically in the existing IndexedDB stores.
Old responses cannot overwrite a revoked key; blind snapshot APIs cannot bypass
the reserved namespace. Twenty-six store tests and scoped lint pass. This is an
unused primitive, not an enabled receiving cache, permission grant, production
schema change or physical timing result. Missing cross-tab events cannot
retroactively erase already-painted data; callers must suppress/revalidate it.

## Quota failure preserved; R19 HTTP pass — 2026-11-11

The one supplemental diagnostic stopped with `EDQUOT` while copying synthetic
tiles into its two new fixtures, before either application or browser started.
It collected zero timings and will not be retried. Both owned PostgreSQL groups
and the outer process family are absent, both sockets were removed and ports
3485/3486 are closed. Because seeding failed before the callback, the missing
standalone schema/final raw log copies are explicitly recorded rather than
reconstructed. Existing R17/R18 app snapshots were not refreshed. Evidence:
`artifacts/quantity-office-diagnostic-2026-11-11-attempt1/`.

The quota-limited `/tmp` filesystem was 48 GiB used. Four inactive owned lab
snapshots were copied to a private archive on the main disk and checksum-verified
before duplicate removal, freeing about 11 GiB. Their original paths remain
symlinks; source, built files and evidence are retained. Readonly generated
directory permissions initially blocked duplicate removal; only those verified
duplicate directories were made writable to complete cleanup. Active baseline,
R17 and R18 paths remain in place. See `artifacts/inactive-lab-storage-archive-2026-11-11.json`.

R19's read-only HTTP check passed all 293 current assets, ten retained samples,
the dedicated press chunk, service worker and public manifest. Health/sign-in
returned 200; unauthenticated cache binding returned 401. Server/supervisor exited
cleanly and port3150 closed. Proof `7a9c17e5`; production remains Phase0.
The exact private R19 compile/preflight is now cleared after storage recovery;
its full timing comparison is still pending.

## R19 full comparison running — 2026-11-11 16:38 UTC

The new R19 private app compiled as `2e5AUhfrGey7tubpAbx-8`, with all fourteen
actual reads passing, 113 tables from sixteen schema modules, zero PostgreSQL
errors and verified cleanup. It binds exactly to canonical build `47b6e705…`
and fingerprint `4541b37e…`; it is never a deployable artifact. The prior V6
functional proof remains R18-bound and is not relabelled.

One original v2 full run began at 16:38:05 UTC: ten minutes idle, then all
120 samples against the unchanged original baseline1. Root recomputed the five
operational hashes and frozen method; source/method/semantic environment guards
passed before database startup and idle. The launcher differs from the executed
R18 launcher only in R19 identities/paths, and contains no diagnostic process
monitor. No retry, exclusion, result or activation is authorized by this start.
All other tests/builds/app work are stopped while source reviews continue.

## R19 rejected; independent Phase 1 work continues — 2026-11-11

The complete original-v2 R19 run retained all 120 samples and failed five of 24
cells: job opening on Site/Office, material-list opening on Basement/Site, and
quantity change on Site. Nineteen cells pass. Root independently reran the frozen
report validation, accepted baseline-pair repeatability, original comparator and
activation-report validation: only those same five timing failures remain.
The 74-read idle check and static ratchets pass, PostgreSQL has zero errors,
source/method/schema bindings match, and all owned Next/PG processes were cleaned.
No activation, retry, exclusions, alternate comparator or budget waiver. Production
remains Phase 0. Archive: `c08b4763`; root review is in
`artifacts/candidate-r19-ready-then-pinch-v2-2026-11-11-root-review.json`.

The source/raw-only audit `279b9f2f` retains both versions' raw samples and browser
marks for each rejected cell. R19 changes four source files relative to R18:
job-chat badge refresh, quantity feedback, Button forwarding and usePress. The
material-list screen/queries are unchanged, but shared primitives and bundles
changed; this does not establish a cause or justify subtracting timer overhead.
No further candidate or trace is queued.

A separate notification identity slice (`1ad6447c`) passes 37 focused tests and has
no new lint findings; 17 inherited router findings were reproduced against HEAD.
It reuses only a fresh, correctly bound role response and restores standalone
checks after expiry or lifecycle changes, without a recovery retry loop. It is
not in R19, not activated and not a measured polling reduction. Receiving saved
summary work remains under final functional/account-lifecycle review.

Anonymous live telemetry continues without the Pixel debug connection. The
17:09 UTC cumulative snapshot contains 105 beacons/2,066 observations, 45/638 more
than the prior review. Phone-class startup has 24 marks (median 808.5 ms), INP has
five (sample p75 = 104 ms), and tap-to-paint remains three (median 593 ms). These are
uncontrolled, sampled observations with no per-row hardware or repeat-visit
verification; they do not establish field targets or complete Phase 0. See
`artifacts/field-review-2026-11-11-after-phone-deferred.json`.

## Receiving summary pass; notification experiment rolled back — 2026-11-11

Receiving saved summaries (`7286af50`) pass 103 tests across eleven files, scoped
runtime TypeScript and lint with no new findings. The original unrelated router
and Activity-fixture lint findings were reproduced against HEAD. Two initial
legacy fixture failures were corrected without weakening their assertions.
Saved details are a separate, dated, read-only projection: at most 32 lines and
16 KiB per order, with 256 KiB reserved within the existing 20 MiB payload cap.
No received/credited quantities, contacts, notes or receipt capabilities persist.
Key/account epochs fence stale callbacks, denied reads and view changes; same-order
notes/verification share one active read. Known actor mismatch hides cached paint.
Unusable IndexedDB falls back to live reads; durable deletion cannot be guaranteed
while that storage is unavailable. This is tested source, not a new canonical
build, browser timing, offline-write or production rollout proof.

The subsequent notification two-cycle diagnostic disproved the optimization:
with ordinary 30-second role polling and 250 ms replies, identity requests still
ran each cycle and the first lease expiry closed an open inbox. The 37 earlier
focused tests and passing typecheck did not cover that behavior. Rollback
`aeb21094` restores all four existing notification/router files byte-for-byte and
removes the new runtime hook; the original 18 tests pass with no new lint findings.
The experiment commit, diagnostic source, raw logs and failure are preserved in
`artifacts/notification-role-identity-rejected-2026-11-11/`. No polling reduction
is claimed, and the experiment never reached production.

## Receiving/photo canonical proof authorized — 2026-11-11

The photo metadata boundary (`e206f3a6`, corrected by `46a30bf2`) passes eleven
focused tests. It defers the unchanged 1,467-entry framing map, reserves each
photo box while loading and keeps a displayed failure fallback from later
recropping. The exact cache-completion-before-effect race is covered. The old
map-containing chunk is 53,313 gzip bytes; that is an opportunity, not a saving.

Source freeze `d49f0f95` composes only these two image runtime paths and the eight
reviewed receiving runtime postimages onto exact R19. Root independently confirms
fingerprint `d22e3464…`, 2,322 source files and exactly ten changed/new runtime
paths with no deletion. The protected-key prerequisite is included; public/config
and R19's existing badge/quantity paths remain unchanged. No timing regression is
reverted or waived. One canonical byte/type proof is authorized, with no HTTP,
private database, browser matrix, worker or activation.

The separate shared-bundle audit `9dcac8e5` retains the unchanged formal 477,538
gzip-byte definition and identifies a 17,273-byte dropdown-engine opportunity
ceiling. First-open/focus/keyboard risks keep that proposal source-only. Framework
root files account for 118,402 bytes; this classification does not redefine the
120 KB target or establish that all remaining code is removable.

## Receiving/photo canonical proof passed — 2026-11-11

Build `95b57fd0…` passed canonical compilation, production TypeScript, prerender
and source laws on the first attempt. Source fingerprint `d22e3464…` and all
2,322 inputs remained unchanged. The combined receiving/photo change measures
478,853 shared and 575,264 heaviest gzip bytes: +1,315 / −52,473 relative to R19.
All Phase 0 byte ratchets pass; final 120 KB/180 KB targets remain unmet. The
strict R19 update payload is 445,298 bytes (42 of 288 scripts changed), failing
100 KB. This full-batch result is not replaced by a net-code-growth figure.

The 52,638-byte framing-map chunk is now async and absent from root files and
all forty formal jobs-route dependency lists. It remains counted in deployment
bytes. This is emitted-code evidence, not a browser transfer or isolated
photo-only performance claim. All 293 compressed assets, 1,120 retained files
and 3,263 public files match; native metadata resolution and production-overlay
exclusion pass. Proof `ab3ee49c`, detailed in `receiving-images-byte-proof.md`.
No HTTP/application/private database/browser matrix/worker/activation ran. The
R19 timing rejection still stands; no new full matrix is scheduled.

## Photo component browser proof — 2026-11-11

The isolated browser proof (`e23e71d2`) exercises the actual PartImage component
and Next Image implementation with local synthetic assets and an explicit
metadata fixture. Fixed/fill geometry, audited SVG framing, latched failure
fallback and a same-page cached-metadata remount pass. No page errors or external
requests occurred; the browser, loopback server and temporary profile were
cleaned up. Three earlier harness failures are preserved separately. This proves
component behavior, not production chunk availability offline, real-photo visual
fidelity, Safari, phone performance or release acceptance. See
`part-image-browser.md` and `artifacts/part-image-browser-2026-11-11.json`.

## Chat overview producer correctness — 2026-11-11

The new chat-overview topic invalidates the existing exact overview query after
join, read-cursor and mute changes. It uses the current web process's own LISTEN,
scopes personal hints to the effective actor and admitted jobs, and never advances
durable chat-message cursors. The browser observer is passive: it adds no stream
subscription, and all existing overview polling intervals remain unchanged.

Thirty-four focused unit checks, scoped runtime TypeScript and lint pass. One
source-bound disposable PostgreSQL run then passed three integration cases:
actual writers deliver three matching-actor hints and zero peer hints, repeated
no-ops do not notify, outer rollback suppresses notification/row, and a deliberate
pg_notify permission failure rolls back its savepoint while surrounding business
rows commit. Listener barriers establish absence without a fixed sleep. Exactly
one expected SQLSTATE 42501 and zero unexpected database errors were observed.
All 28 source hashes match before/after; listener and supervised processes exit,
the final PG log is copied after shutdown, and the private socket/data are removed.

This uses an injected real private Drizzle client and a thin synthetic fixture.
It does not prove production authentication, the production DB module, compiled
web topology, browser delivery latency or poll removal. Role/session expiry and
other authority-change coverage remain open. No application build, production
schema, worker release, speed-matrix rerun or activation occurred. See
`live/chat-overview-hints.md` and `live/chat-overview-pg-plan.md`.

## Failed-cell profiling and timer fixes — 2026-11-11

A separate instrumented diagnostic completed one Phase 0/R19 pair for each of
the five failed cells. All ten operations, original default adapters, raw traces
and profiles remain preserved; both private 14-read preflights pass, database
errors and write-guard rejections are zero, and all owned runtime is cleaned.
These observations do not replace the full R19 rejection or count as another
accepted matrix. Profiling overhead and negative CPU sample deltas prevent
precise component-cost claims. See `artifacts/failed-cells-diagnostic-2026-11-11-attempt1/`.

The traces identify repeated native timer resets from cache observer events:
25 installation/removal pairs per job opening, 110 per material-list opening and
six per quantity operation. Fix `2e32a462` keeps one pending persistence timer
while preserving the trailing 300 ms quiet period, all eligibility notifications
and immediate authority denial. Eight focused cases plus existing cache/update
suites pass (39 tests); scoped lint and independent review pass. Fix `fff75a2a`
skips absent update-coordinator timers while retaining interaction timestamps
and safe release conditions; four focused cases and lint pass. No latency
improvement is claimed yet.

The next candidate will contain exactly these two runtime patches on R19, plus
their test sources. The already prepared receiving/photo and chat changes remain
separate. Production still runs the Phase 0 bootstrap; no worker or schema change
has been made, and Pixel debugging remains deferred at Tim's request.

## R20 prepared and full run started — 2026-11-11 23:12 UTC

R20 contains exactly the two timer runtime patches on R19. Its frozen-source
36 tests, canonical build, production TypeScript and prerender pass. Root
independently verifies source fingerprint `b6f4093d…` (2,318 files), canonical
build `e9fcb1f8…` and the two intended runtime diffs. All 293 current compressed
assets, 1,120 retained files and 3,263 public files match offline. Formal Phase 0
byte ratchets pass at 477,608 shared / 627,807 heaviest / 1,322,690 deployment
gzip bytes. Final 120 KB/180 KB script targets are still unmet.

The exact two-fix R19-to-R20 update is 27,818 gzip bytes across six changed
scripts and passes 100 KB. That does not make the full Phase 0-to-R20 batch
27 KB. Cookie-free read-only HTTP checks pass for 293 current assets and ten
historical samples, packaged service worker, health/sign-in and denied anonymous
private binding. Manifest validation is status plus build ID, not full-body
byte equality. The proof server is stopped. See `phase1-r20-byte-proof.md`
and the source/build/HTTP artifacts.

The new private lab build `3c6Lvo7KDnEDe_Bzts7L-` passes all fourteen actual
query preflights with 113 tables from sixteen source schema modules. Its compile
resources are cleaned and the helper's final error summary is empty. Root checks
the original harness fingerprint, six orchestration hashes and three protocol
positive/negative checks. One full run started at 23:12:42 UTC: 600,000 ms idle
plus all 120 samples, with baseline 1 as the unchanged comparator. No full result
is available at this checkpoint. R19 remains rejected, production remains Phase
0, and heavy parallel work is paused for the measurement window.


## R20 full result — rejected, 2026-11-11

All 120 samples and the ten-minute idle observation completed. R20 passes 23 of
24 timing cells and all static/poll regression ratchets. The five failed R19
cells now pass, but Basement job opening is 98.416 ms versus the fixed 82.444 ms
baseline (+19.37%). Its five samples are 99.027, 81.489, 98.416, 82.504 and
99.274 ms. No sample, comparator or threshold was replaced. This is a combined
two-fix result, not isolated causal evidence for either timer change.

Root independently reran report validation, accepted baseline repeatability,
formal comparison and activation-report validation. Only that same timing cell
fails; the candidate remains rejected. This is report-level activation rejection,
not a passing complete asset/activation preflight. All source/schema/method
bindings match, fourteen actual query preflights pass, database errors are zero,
and all owned app/database processes, sockets and ports are cleaned. The idle
observation records 74 queries, three stream starts, two closes and no overlap;
it does not establish heartbeat delivery or zero polling. See
`artifacts/candidate-r20-ready-then-pinch-v2-2026-11-11/` (`47847d9f`) and its
independent `root-review.json`.

The one-frame-sized remaining difference warrants an unchanged-build control;
it does not prove noise or waive the gate. One complete Phase 0 self-comparison
is being prepared with the original method and fixed baseline pair. A pass would
count only as one of the plan's twenty false-alarm validations and would not
clear R20. A failure would demonstrate a false alarm on unchanged code and call
for measurement calibration review. No automatic repeat-until-pass runs or
candidate activation are authorized. Production remains the Phase 0 bootstrap.

The 21 raw failed-cell diagnostic files (34,612,701 bytes) are also retained in a
private persistent proof directory with verified hashes. The original report,
index and source evidence remain unchanged; the durable mapping is
`artifacts/failed-cells-diagnostic-durable-archive-2026-11-11.json`.


## Live telemetry follow-up after R20 — 2026-11-11

A read-only cumulative snapshot now contains 150 anonymous beacons and 3,009
metrics, up 45/943 from the 17:09 UTC review. Phone-class startup has 29 samples
(median 877 ms); INP has six (sample p75 104 ms), and tap-to-paint has five
(median 593 ms). These small uncontrolled counts do not prove reference-phone,
repeat-visit, offline, launch-from-icon or stable percentile targets. They all
belong to the unchanged Phase 0 build, not R20. The numeric-only raw snapshot is
preserved privately and hashed; aggregate evidence is
`artifacts/field-review-2026-11-11-after-r20.json`. The live service remains active
on the Phase 0 canonical release. Pixel debugging remains deferred.


## Notification ownership functional proof — 2026-11-12

Prepared client-only slice `acca100a` uses successful current-account overview
responses to replace the redundant notification identity interval. The existing
overview cadence and identity bootstrap, invalidation and recovery remain. Cached
or old responses cannot establish ownership; account, mount and request-authority
fences retain same-account dialog state across benign pauses. Independent review
caught and repaired a slow-overview/new-identity race before the browser proof.

Twenty-seven tests across four files, scoped lint and scoped runtime/test
TypeScript pass. One actual Center/Dialog/QueryClient browser fixture with 250 ms
HTTP replies observes two 30.256-second cadence gaps: four overview replies
(including bootstrap and open) and one identity reply during that window. The
same dialog/input DOM and edited value survive healthy refresh, offline/reconnect
and cooperative pause/resume. Sources remain unchanged and the browser, local
server/port and temporary files are cleaned. All earlier failed checks remain
preserved. The fixture explicitly substitutes transport and panel content; it
does not prove production authentication, batching, full-app idle savings or
latency. No build or activation. See `notification-overview-owner.md` and
`artifacts/notification-owner-http-attempt-UqLd7p/`.

## One unchanged Phase 0 control started — 2026-11-12 00:01 UTC

The exact retained Phase 0 canonical source and compiled lab are being compared
to fixed baseline 1 using the unchanged v2 method, all 120 samples and a ten-minute
idle observation. Baseline 2 remains the repeatability reference. Root and a
second reviewer checked all seven final orchestration hashes. Nine control guards
pass, including rejection of changed source, subset runs, extra diagnostics and
incorrect static references. Setup passes all fourteen actual reads and reproduces
the original static values. The pre-bootstrap static predecessor is reconstructed
from the release manifest and checked against original measured values; the old
launcher environment itself was not independently retained.

This is one prospective unchanged-build validation, never an R20 rerun or release
candidate. No additional trials are scheduled. Every result will be retained;
no final control outcome exists at this checkpoint. All other heavy work is
paused. Preparation is in
`artifacts/phase0-self-control-ready-then-pinch-v2-2026-11-11-preparation/`.


## Phase 0 control passed; approved catalogue fastlane next — 2026-11-12

The single predeclared unchanged-build control completed all 120 samples and
passes all 24 cells against the fixed baseline 1. Root independently confirms
report validation, baseline-pair repeatability and comparison return no errors.
The ten-minute idle observation has 80 reads and one non-overlapping stream.
Fourteen read preflights pass, source/method bindings remain exact, database
errors are zero and both app processes, private database, socket and port are
cleaned. Quiet was released at 00:31:04 UTC. Archive `0430c752` and root review
are in `artifacts/phase0-self-control-ready-then-pinch-v2-2026-11-11/`.
This is one prospective false-alarm validation of twenty, not clearance of R20.

Tim explicitly approved `/home/tim/Documents/foremanhq-fastlane/REQUEST.md` and
requested its build, strict small-change check, full candidate matrix and guarded
activation only if every applicable gate passes. This takes the next runtime slot.
The source is the actual frozen live Phase 0 plus only CatalogueVisibility.tsx
from `669d7f83`. Both reviewers and root verify the exact preimage/postimage and
one-file diff; root independently verifies fingerprint `34f0c150…` / 2,200 inputs.
The source's `.next` points to actual active Phase 0, so retention and changed
bytes cannot accidentally use its older predecessor.

The approved original Phase 0 recipe runs with external current safety/toolchain
checks; source scripts are unchanged. Operational post-build packaging must retain
exact active runtime wrappers/public assets and bind the actual source fingerprint.
The separate full matrix uses the original v2 method and fixed baseline pair.
All failed checks remain failures; no budget adjustment or R20 waiver is allowed.
Other notification, receiving, photo, asset-request and drawing changes are excluded.
At this checkpoint no fastlane build result or activation exists.

## Approved one-file fastlane entered full matrix — 2026-11-12 00:47 UTC

Exact Phase 0 plus CatalogueVisibility.tsx passed its nine unit tests. A browser
fixture using the actual Phase 0 cards reproduced the old double selection with
trusted touch events (steps 2, 4) and passed with the approved file (steps 1, 2).
Keyboard, movement cancellation, long press and listener expiry pass. The
synthetically suppressed compatibility-click weakness is recorded separately;
this is not full-app or Pixel evidence. See `fastlane-wizard-component-proof.md`.

Canonical build `9aaeabbe…355b0` passed TypeScript/prerender on the original
Phase 0 recipe. Shared/heaviest bytes are 502616/758529; all formal byte ratchets
pass. Strict changed JavaScript is 33690 gzip bytes, six scripts changed and
249 reused, below 100000. Exact active runtime/public and historical assets are
preserved. Read-only HTTP checks and anonymous user.getMe 401 pass; both servers
are cleaned. The old runtime config's two absent false-default values were
normalized only for comparison; copied runtime config bytes are unchanged.
Failed setup assertions are preserved. See `fastlane-wizard-canonical-proof.md`.

The fresh private compile and fourteen actual read checks pass, with zero database
errors and clean teardown. Root and peer independently checked the final source,
lab and helper hashes. One full capture started at 00:47:55 UTC with the original
v2 method, fixed baseline pair, ten-minute idle and all 120 samples. Static delta
uses actual active Phase 0. No other builds/tests run during this window. The
full result is pending; live production remains Phase 0 and activation is held.

## Approved wizard fastlane activated — 2026-11-12 01:18 UTC

The full candidate capture passed all 24 cells and 120 samples against the fixed
accepted Phase 0 baseline. Ten-minute idle has 80 reads and one non-overlapping
stream, matching baseline. Source/method hashes, schema/read preflight and zero
database-error evidence pass; all test processes and private storage are cleaned.
Root independently verified the archived raw report, exact one-file source diff,
repeatability and comparison, then the complete read-only activation gate.

The first read-only gate call preceded the report archive and correctly blocked
on the missing file. It made no activation attempt. After the byte-identical
archive was available, the definitive gate passed. Root ran `activate.mjs`, which
passed its own preflight and activated build `9aaeabbe…355b0` at 01:18:47 UTC.
All eighteen public checks pass: health/sign-in 200, protected endpoint 401,
service worker bytes, all six changed scripts and an old script via Brotli/gzip.
The service is active, running, with NRestarts=0. No database or worker changes.

Evidence: `artifacts/wizard-fastlane-ready-then-pinch-v2-2026-11-12/`
(`report.json`, `root-review.json`, `activation.json`, `public-edge.json`).
The original Phase 0 baseline pair stays bound to c25/128d; it must not be
relabeled as this new active source. Future activation must satisfy the existing
gate's active-build/baseline binding and use the actual active fastlane for its
deployment delta. No new baseline run is part of this request. Broader R20,
notification, receiving, photo, assets, sync and drawing work remain separate.

## Phase 1 continuation — 2026-11-12

Tim requested a plain-language Phase 0 recap and continuation into Phase 1. The
next increments remain based on the exact active source, with the wizard fix
preserved. The asset-request read slice is committed at `431edff6`: two runtime
callers retain exact cached rows behind a refresh, suppress known denials and
distinguish unknown offline data from a cached empty list. Fourteen focused
tests and scoped lint pass. This is prepared source, not activated or durable
offline-write coverage.

A separate two-file notification ownership candidate is frozen from active
fastlane (`2c5a75da…87421`, 2201 inputs). It preserves the older inline inbox
and moves only authoritative overview/identity ownership into the reviewed hook.
The newer lazy-panel fixture is insufficient for this exact older UI: source-bound
inline filter/settings/dialog/read tests are being prepared. No canonical build
or poll-saving claim exists yet. New hook bytes may fail the shared ratchet;
any failure remains a failure. A possible optional-panel split is only a scoped
conditional proposal, not an implemented or measured remedy.

At 01:42:17 UTC one independent active-source repeat started. Its fixed first
is the sole untrimmed successful fastlane capture, selected prospectively before
this repeat. Same source9aae/34f, retained compiled lab, frozen f9/v2 method,
120 samples and ten-minute idle. Both two-sided repeatability and original
comparison run after capture; either failure is retained. Static predecessor
remains c25 to match the first report. Future candidate deltas use active9aae.
The new first's 33690 deployment/502616 shared/758529 heaviest/80 idle values
are not silently replaced by the older, looser values. Source-only work proceeds
during quiet; all other runtime is held. This does not clear R20 or finish the
20 unchanged-build validation, field/phone checks, or Phase 1.

## Active-source repeat rejected; Phase 1 source work continues — 2026-11-12 02:11 UTC

All 120 samples completed with valid source/method/fixture evidence, fourteen
read preflights and zero database errors. Cleanup passes. Twenty-three cells
pass repeatability; Office material-list opening moves from 205.817057 to
232.029312 ms and fails the unchanged 10% band. Both postchecks reject. This
is the same compiled source, so the pair is not accepted for future activation;
no samples are removed, no rerun scheduled and no threshold changed. Original
fastlane activation evidence remains historical; live source is unchanged.
Archive `37d8aac4`: `artifacts/active-wizard-baseline-repeat-2026-11-12/`.

Root independently confirms the rejection and raw SHA. Supplemental browser
tap-to-paint medians are 154.800000 to 158 ms; paired outer-minus-browser
residual medians are 51.592925 to 72.837922 ms. These arithmetic differences
are clues about measurement boundaries, not a subtraction from the gate or
causal attribution. Source/raw review precedes any separate bounded diagnostic.

The frozen inline notification proof passed source review after pinning its
operational test setup outside frozen inputs and tightening deferred-ACK
assertions. Its unit stage is now authorized after quiet cleanup; no browser
or canonical build result yet. Functional work continues without asserting
release eligibility, full Phase 1 completion or physical-phone performance.

## Exact inline notification behavior verified — 2026-11-12

The narrow active-source notification candidate passed 29 focused tests, scoped
lint and types. Its one bounded browser attempt retained the actual inline inbox,
All filter and settings through two real 30-second refresh cycles. During that
window it made one identity request and four overview requests. Read/settings
acknowledgment, Close/reopen and offline/pause recovery checks passed. Root
independently verified unchanged source/input hashes and complete owned cleanup.
Evidence is committed at `b1f7032c`. Transport and account data are synthetic;
this is behavior evidence, not full-app idle savings, physical-phone speed or
activation eligibility. The failed active-source baseline repeat still blocks
release. A separate canonical build/byte check is authorized after capacity
preflight; no additional timing matrix or activation is authorized.
