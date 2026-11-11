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

## Reviewed candidate and baseline status — 2026-11-11

- The original two full `early-pinch-v1` captures each contain 120 samples, with
  passed read preflight and zero database errors. Repeatability failed one of
  24 cells: Site sheet opening/pinch moved from 973 to 1,432 ms median. Both raw
  captures remain archived. There is still no accepted full baseline.
- `ready-then-pinch-v2` explicitly waits for the initial sharp sheet before the
  same verified viewer pinch, charging both waits to the outer timer. Its
  calibration is a different method, not a repaired v1 result. The new frozen
  Phase 0 pair completed 240 samples with matching method/source bindings and
  zero database errors, but failed Basement material-list repeatability:
  203.9 → 229.0 ms (+12.35%). The other 23 cells passed. Both raw reports and
  recorded brief ADB setup overlaps are archived; no samples were excluded.
  There remains no accepted baseline and no cross-protocol improvement claim.
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

The first-20 write step currently has six converted procedure/caller actions;
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
