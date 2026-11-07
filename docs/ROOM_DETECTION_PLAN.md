# Room detection: master plan and handoff

**Status: active plan, written 2026-10-02. This is the single source of truth for room-detection work.**
If you are an AI agent or developer picking this up: read all of this file before changing any
code under `src/server/rooms/`. Update the "Progress log" at the bottom when you finish a step.

---

## 1. The problem in one paragraph

ForemanHQ lets a foreman upload a construction drawing set (PDF) and turns each floor-plan sheet
into a list of rooms, each with a polygon outline drawn over the sheet. Rooms are proposals that a
person reviews (approve / reject / repair / add). Detection has been rewritten many times since
2026-09-20 and the owner (Tim) still sees rooms that bleed into neighbouring spaces, missing rooms,
and junk spaces. **The root cause of the churn is process, not just algorithms:** there is no
answer key for real drawings, "good" was never defined, every change was judged by eyeballing
pictures, and two agents (Claude, and Halvor/Codex) changed the same code in parallel.
This plan fixes the process first, then the algorithm.

## 2. Goal and definition of done

**Product goal (confirmed by Tim on 2026-10-01: "units/suites only"):**
On an architectural floor-plan sheet, propose one room per **apartment unit / suite** and one per
**common space** (corridor, lobby, vestibule, stair, elevator, amenity room, service room such as
electrical, janitor, garbage, storage). Rooms *inside* a unit (bedroom, bathroom, closet) are **not**
separate rooms. Nothing is auto-approved; everything goes through the review screen.

**Definition of done (proposed; Tim to confirm or change):**

| Metric (per sheet, against the answer key) | Ship gate |
|---|---|
| Recall: reference rooms matched at IoU ≥ 0.5 | ≥ 95 % |
| Bleeds: one proposal covering ≥ 50 % of two or more reference rooms | ≤ 2 per sheet |
| Junk: proposals matching no reference room (excluding balconies/shafts, tracked separately) | ≤ 5 per sheet |
| Naming: matched rooms carrying the correct room number/name | ≥ 90 % |
| Time for a person to fix the rest in the review screen | < 5 min per floor |
| Runtime / memory on the server worker | < 30 s, < 4 GiB RSS |

No change ships unless it beats the current live version on these numbers on **every** answer-key
sheet (no regressions traded for gains elsewhere).

## 3. Rules for anyone working on this

1. **One owner at a time.** Before changing room detection, check the Progress log for who owns it.
   Halvor/Codex research experiments must not land on `tim-development` while another agent owns it.
2. **Measure, don't eyeball.** Every detector change is run through the scoring script (Phase 1)
   on all answer-key sheets, and the before/after numbers are written in the Progress log.
3. **Never tune on the holdout sheet.** One answer-key sheet (from a different architect) is held
   out and only scored once per candidate, right before shipping.
4. **Tim decides deploys.** Build, test and show results; merge into `tim-development`, deploy or
   push to GitHub only when Tim says so. Never auto-approve rooms.
5. **No reasoning/LLM models in the detection path** (Tim's stated preference). General vision
   models were tested and failed (see section 5). A small detector trained on our own data is
   acceptable later if needed.
6. **Explain in plain language.** Tim is a construction person, not a developer. Results go to him
   as: a picture per sheet + a short table of the metrics above.

## 4. Current state (2026-10-02)

### Live system
- Live checkout: `/home/tim/.openclaw/workspace/kublai`, branch `tim-development`, commit `9f9f8e2`,
  served build `.next-room-necks-20261002` (systemd user service `foremenhq`, Postgres 18 on 5433).
- Deploy procedure: see memory file / section 9.
- Entry point: `src/server/rooms/detect-job.ts` → `runCompleteDetectAllRooms()`
  - calls `detectTaggedRooms()` (`src/server/rooms/tagged/detect-tagged.ts`) when the sheet has
    ≥ 3 room tags; otherwise falls back to the older label-free `detectAllSpaces()`
    (`src/server/rooms/hybrid/all-spaces.ts`).
  - results saved by `saveCompleteCandidates()` as `kublai_job_room` rows, `reviewStatus = pending`,
    `detection.version = "tagged-units-v2"`.
- Review UI: `src/app/dashboard/jobs/[jobId]/rooms/page.tsx`; review decisions are stored in
  `kublai_room_detection_feedback` (approve/reject + proposal and corrected shapes).
- Room shapes: `{ type: "polygon", points: [{x,y}], holes? }`, x/y normalized 0–1 of the sheet.

### Current pipeline (`detectTaggedRooms`)
1. **Room list from PDF text** (`tagged/room-tags.ts`): room name above a room number
   (`EXIT CORRIDOR` / `A-118`), or a unit number above its type (`N221` / `MICRO`). Rotation-aware,
   one seed per room number, door tags (no name above) ignored. Plus plain room-name seeds from
   `pdf-walls.ts` `extractPdfRoomSeeds` + `physical-labels.ts`.
2. **Walls-only render** (`tagged/structural-render.ts`): PDF rendered at 5000 px long side with
   text, dashed strokes, grey (screened background) and coloured (revision clouds) ink removed;
   grey poché between black wall faces kept.
3. **Real walls only** (`tagged/wall-weights.ts` `keepDoubleLineWalls`): double-line or solid wall
   bands kept, single thin strokes (door swings, fixtures, furniture) dropped. `openSpaceMask`
   blocks courtyards/site larger than 12× the median seeded room.
4. **Split at doorway "necks"** (`tagged/neck-partition.ts`): distance-to-wall watershed; space
   narrower than 2 × 0.3 % of the page's long side separates rooms.
5. **Assemble units**: unnamed regions reached from exactly one named, non-circulation room through
   a direct opening join that room; regions touching ≥ 2 named rooms stay separate
   (corridors). A closet/electrical tag that opens onto ≥ 3 rooms is renamed "Corridor".
6. Outline polygons (`tagged/outline.ts`).

### Known weaknesses (the thing to fix)
- **Doors are not recognised; they are guessed from gap width** (step 4). Wide openings
  (double doors, storefronts, open plans) bleed; narrow non-door pinches split rooms; the width
  threshold is tied to page size, not drawing scale. This is the main cause of bleeding.
- Some tagged rooms are not traced (A511 amenity wing: Univ. Washroom, Storage, Elec. Rm., etc.).
- 26–39 unnamed spaces per sheet (mostly balconies, shafts, exterior niches).
- Small corridor pieces sometimes attach to a unit.
- Reflected ceiling plans (e.g. A284) are poor (ceiling grid looks like walls); they should
  probably not be detected at all.

### Work in progress (not merged)
- Worktree `/home/tim/.openclaw/worktrees/foremanhq-room-tags`, branch `claude/room-tags`.
- `src/server/rooms/tagged/doors.ts` (**uncommitted**): vector door-swing finder. Reads PDF paths
  with transforms, fits circles to Bézier curves and to chains of short line segments, groups
  arcs, keeps 55–115° swings, finds the leaf line, flags double doors, and `sealDoorways()` paints
  each doorway closed on the raster.
  - A511 (Martin Simmons Sweers): swings are true Bézier curves; finder works (many hits; needs
    false-positive filtering: section-marker circles, revision-cloud scallops, text glyphs).
  - A501 (Sweeny&Co): swings are **flattened into chains of ~7–12 short straight segments in
    separate subpaths**. Verified by hand: a chain fits a circle with 0.26 % error and a 90° sweep,
    hinge at the right place. **Bug: the chain-joining step in `polylineArcs()` doesn't link
    these pieces** (suspect: endpoint key quantisation or the degree-2 test). Fix this first.
- Scratch scripts in the worktree `.tmp/` (run-module.ts, run-neck.ts, doors-*.ts) and overlays in
  `/home/tim/.openclaw/workspace/rooms-improve/` (not in git).

## 5. What has been tried, and why it failed (do not repeat without a new reason)

| Approach | Outcome |
|---|---|
| Label-free enclosed-space finder (`all-spaces-v1`, live until 2026-10-01) | 116 of 128 A511 proposals unnamed; courtyard/site merged into rooms |
| Units by heavy-wall thickness only (`tagged-units-v1`) | Units bled into corridors and each other |
| Raster detectors from the bench (hybrid density-geodesic, etc.) | Good on public datasets (MSD ~93 % F1), poor on real sheets |
| U-Net trained on synthetic Swiss/MSD renders (Halvor, several variants) | Rejected on A511: leaks, fixture splits, merges |
| SAM 2.1 promptable segmentation | Selects furniture, merges rooms, fragments halls |
| Qwen3-VL-2B (Halvor, 2026-09-30) | Output regular coordinate grids, not geometry |
| **Qwen3-VL-8B 4-bit (Claude, 2026-10-02)** | Reads room names correctly; door boxes on fixtures/walls or degenerate grids; room boxes form grids that ignore walls. Rejected. Kit: `/home/tim/datasets/foremanhq-room-detection/vision-8b/` |
| Fixed "necks" partition (`tagged-units-v2`, live) | Much better; still bleeds where doorways are wide/ambiguous |

**Lesson:** general vision models and models trained on synthetic plans don't transfer to real
construction sheets. The PDFs already contain exact vector geometry (walls, door swings, text);
use it.

## 6. Test material

All in job `0391aed4-7773-47ec-9141-09df373ec008` (Alma Phase #2), under
`uploads/job-floor-plans/0391aed4-7773-47ec-9141-09df373ec008/`:

| Sheet | PDF | Page | Notes |
|---|---|---|---|
| A501 in app = drawing **A202 Level 2** (Sweeny&Co) | `e787c27f-…/plan.pdf` | 1 | Dense micro/nano units, angled south wing, amenity spine. Doors = flattened polylines |
| A511 in app = drawing **A204 Level 01** (Martin Simmons Sweers, 414 Westhaven) | `8a769e9c-…/plan.pdf` | 18 | Two suite wings, amenity wing, courtyard. Doors = Bézier arcs |
| A205 Level 02 | `8a769e9c-…/plan.pdf` | 19 | Typical suites |
| A284 Level 01 RCP | `8a769e9c-…/plan.pdf` | 29 | Ceiling plan; should be excluded/flagged, not detected |

Note: the app's floor name (A501/A511) is not the drawing number printed on the sheet.

Public corpora and the offline bench harness: `/home/tim/datasets/foremanhq-room-detection/`
(ResPlan, Modified Swiss Dwellings, HABS scans; `scripts/rooms/bench/`). Useful for unit tests of
geometry only; they do not predict real-sheet accuracy.

## 7. The plan

### Phase 0: Governance (½ day)
- [ ] Tim confirms the definition of done (section 2) or edits it.
- [ ] Tim asks Halvor to pause room-detection changes; owner recorded in the Progress log.
- [ ] Tim provides at least one floor-plan PDF from a **different architect/project** (holdout).
- [ ] Live detector stays as is (`tagged-units-v2`) until something beats it.

### Phase 1: Answer key and scoring (1–2 days). **Nothing else starts before this is done.**
1. **Ground-truth format** (`/home/tim/datasets/foremanhq-room-detection/real-sheets/<sheet>.json`,
   kept out of git; drawings are client property):
   ```json
   { "sheet": "A202-L2", "pdf": "<path>", "pdfSha256": "...", "page": 1,
     "rooms": [ { "id": "N221", "name": "N221 MICRO", "kind": "unit|common|exclude",
                  "polygon": [[x,y], ...] } ] }
   ```
   `kind: exclude` = balconies, shafts, exterior niches: proposals there are neither credited nor
   penalised as junk (reported separately).
2. **Make the answer keys** for A202-L2, A204-L01, A205-L02 + the holdout sheet: start from the
   best current detector output, correct by hand (merge/split/redraw), render each as a coloured
   overlay, and have **Tim approve each picture** (≈ 15 min total). Corrections can also be made in
   the app's review screen and exported (`src/server/rooms/feedback-export.ts` exists).
3. **Scoring script** `scripts/rooms/real-sheets/score.ts`: run any detector on a sheet, match
   proposals to reference rooms (one-to-one, IoU ≥ 0.5), and report recall, bleeds, splits, junk,
   naming accuracy, runtime and peak memory; write a JSON report and an overlay PNG
   (green = correct, red = bleed/junk, grey outline = missed).
4. **Baseline:** score the live `tagged-units-v2` on all sheets; record the numbers in the
   Progress log.

**Exit:** a single command prints the metrics table for every sheet; the baseline is recorded.

### Phase 2: Failure taxonomy (½ day)
- From the baseline overlays, count every error by cause: door-related bleed, missing tag,
  untraced tagged room, junk (balcony/shaft/annotation), corridor fragment, wrong name.
- Order Phases 3–4 by which causes cost the most points. (Expected: door-related bleeds first.)

### Phase 3: Real doors from the PDF vectors (2–3 days)
1. Fix `polylineArcs()` chaining (section 4); unit-test with a synthetic flattened arc and a
   Bézier arc (both orientations, both swing directions, double doors).
2. False-positive filters: reject arcs whose hinge isn't on/next to a wall band, whose radius is
   outside the sheet's door-width distribution, that sit inside a circle/bubble, or that are part
   of a revision cloud (many scallops sharing a stroke).
3. **Door check:** overlay every detected door on all sheets; count detected vs. doors in the
   answer key (add a `doors` count per room to the ground truth while making it, or count once).
   Target ≥ 95 % of swing doors found, < 5 % false doors.
4. Use doors in the pipeline: `sealDoorways()` before the partition, then split rooms at sealed
   doors; keep the neck rule only as a fallback for sheets with no vector swings (scans).
   Sliding/pocket/bifold doors and cased openings: handle by the neck rule for now.
5. Re-score. **Exit:** bleeds ≤ 2 per sheet with no recall loss.

### Phase 4: Targeted fixes (2–3 days, driven by the Phase 2 taxonomy)
Candidates, each its own small change measured against the answer key:
- Trace tagged rooms that currently fail ("on-wall" seed rejections; e.g. A511 amenity wing).
- Classify balconies/shafts/exterior niches (outside the building envelope or tiny + no tag) and
  drop or mark them instead of "Unlabeled space N".
- Corridor fragments attached to units: assign by door adjacency (a corridor piece that a unit's
  entry door opens onto belongs to the corridor, not the unit).
- Sheet type check: detect ceiling plans/site plans from the title block ("REFLECTED CEILING",
  "SITE PLAN") and skip them with a clear message.
**Exit:** ship gate in section 2 met on all tuning sheets; holdout scored once.

### Phase 5: Fast fixing in the review screen (in parallel, 1–2 days)
- Time a full review of one floor (approve correct rooms, delete junk, add a missed room, fix a
  bleed). Record the time.
- Add what's missing to get under 5 minutes, likely: tap inside a missed room to auto-trace it,
  merge two rooms, split a room along a line, approve all remaining.
- **Exit:** < 5 min per floor measured on A202-L2.

### Phase 6: Ship (½ day, with Tim's approval)
- Show Tim before/after overlays + metric tables for every sheet. Merge, build, deploy per
  section 9 only after he says so. Keep the previous build for rollback.
- Ask Tim to re-run detection on a real floor and report.

### Phase 7: Keep improving (ongoing)
- Every floor a person fully reviews and confirms becomes a new answer-key sheet automatically
  (export via `feedback-export.ts`). Re-score all candidates against the growing set.
- Only if scanned/raster drawings matter: train a small door detector (Apache-licensed, e.g.
  torchvision Faster R-CNN or RT-DETR; **not** Ultralytics YOLO, which is AGPL) on doors from
  confirmed vector sheets rendered to images. Local GPU: RTX 5060 Ti 16 GB.

## 8. Risks and how they're handled

| Risk | Mitigation |
|---|---|
| Answer key built from detector output inherits its mistakes | Tim reviews every key picture; corrections done by hand |
| Overfitting to 3 sheets from 2 architects | Holdout sheet from a different architect; Phase 7 growing set |
| Door finder false positives (bubbles, clouds, glyphs) | Filters in Phase 3.2, measured by door precision |
| Scans/flattened images with no vectors | Neck rule fallback; Phase 7 learned door detector |
| Parallel agents changing the same code | Rule 3.1 and the Progress log owner field |
| Tim frustration from unclear progress | Fixed report format: picture + metrics table per phase |

## 9. Handy commands

```bash
export PATH=/home/tim/.local/share/mise/installs/node/26.8.2/bin:$PATH
WT=/home/tim/.openclaw/worktrees/foremanhq-room-tags   # dev worktree (node_modules/.env/uploads symlinked)
STUBS=/home/tim/.openclaw/workspace/kublai-rooms-dev/scripts/bench/register-stubs.mjs
P=$WT/uploads/job-floor-plans/0391aed4-7773-47ec-9141-09df373ec008
# Run the live detector module on a sheet (writes rooms JSON):
cd $WT && node --import tsx --import $STUBS .tmp/run-module.ts $P/e787c27f-590b-45e6-9c55-1056a9916558/plan.pdf 1 /tmp/a202.json
# Render a sheet for overlays:
pdftoppm -f 1 -l 1 -scale-to-x 7200 -scale-to-y -1 -png $P/e787c27f-590b-45e6-9c55-1056a9916558/plan.pdf a202
# Tests / typecheck:
cd $WT && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit
# Deploy (only with Tim's go-ahead), from the live checkout:
#   git merge --ff-only <branch>; NEXT_DIST_DIR=.next-<name> node node_modules/next/dist/bin/next build --webpack
#   restore tsconfig.json; readlink .next > /tmp/foremenhq-previous-build; ln -sfn .next-<name> .next
#   systemctl --user restart foremenhq; curl http://localhost:3000/api/health
```

## 10. Progress log

| Date | Who | Step | Result |
|---|---|---|---|
| 2026-10-02 | Claude | Plan written | Live = tagged-units-v2 (9f9f8e2). Door finder WIP uncommitted in worktree. Owner: Claude (pending Tim confirming Halvor pause). |
