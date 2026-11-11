# Speed plan execution

Source plan: `perf/SPEED_PLAN.md`, copied unchanged from
`/home/tim/.openclaw/worktrees/foremanhq-ui/SPEED_PLAN.md`.
Its original plan-only header is superseded by Tim’s subsequent authorization.
Authorized by Tim on 2026-11-10, including Sol 6.1 delegation.

## Decisions recorded

- Start phases 0 and 1, using the plan's measured gates and one release recipe.
- Production drawing sample reads and home-directory Rust setup: approved.
  Rust/cargo 1.99.0 are already installed; no replacement needed.
- Saved private last screen: wait for sign-in confirmation. A cold offline launch
  therefore cannot meet the pre-auth private-screen target; show the neutral gate.
- Extend existing Replicache when phase 2 is reached. Production schema changes
  are requested individually; the receiving worker release is a later decision.

## Verified foundations

- Server timing: 4 unit tests and 2 real PostgreSQL integration tests pass.
- Disposable full schema plus seed successfully created and cleaned up: 2 jobs,
  25 parts, list/order/slip, chat, and 40 rendered synthetic drawing sheets.
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
