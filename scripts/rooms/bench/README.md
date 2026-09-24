# Room detection development loop

Offline file-input benchmark of the raster primitives in `src/server/rooms/raster-rooms.ts`.
Does not import app/database/auth modules, load `.env`, call AI services, or modify real jobs.
The live site and Opus's checkout are not involved.

## Start here

From this worktree:

```sh
scripts/rooms/bench/run sweep
```

This compares the Opus baseline, combined candidate, and no-density ablation on a fixed 12-case smoke suite.
Open `/home/tim/datasets/foremanhq-room-detection/experiments/index.html` for the leaderboard.
Each run has input/reference/prediction overlays and JSON diagnostics; comparisons list
improved/regressed cases. Results and cache live outside Git.

The default Python environment is the corpus `.venv`. On another machine, make a venv,
install `requirements.txt`, run `pnpm install --frozen-lockfile`, and set `ROOM_BENCH_PYTHON`.
Node must be on PATH. `--corpus` and `--output` accept alternate paths.

## Repeatable development cycle

1. Run the baseline once. Save its run ID and configuration.
2. Copy a configuration and change ONE hypothesis, or change your isolated detector code.
3. Run `run --config <file>` on smoke. Open the lowest-scoring cases and paired comparison.
4. Test promising candidates on `--suite development` (200 default cases).
5. Compare with a baseline on the same suite. Reject gains that introduce unacceptable
   merges or timeouts; investigate the regression list instead of trusting one aggregate.
6. After choosing a candidate, run the protected holdout once. Do not tune against it.
7. Validate on real, manually annotated project drawings before any production deployment.

```sh
# Change and test one configuration.
scripts/rooms/bench/run run --config scripts/rooms/bench/configs/opus-growth.json

# Larger development suite.
scripts/rooms/bench/run run --suite development --config scripts/rooms/bench/configs/opus-growth.json

# Two specific saved runs. Paths point at run directories, not run.json.
scripts/rooms/bench/run compare /path/to/baseline-run /path/to/candidate-run

# Compare explicit configs; the first is the paired-comparison baseline.
scripts/rooms/bench/run sweep --configs scripts/rooms/bench/configs/baseline.json scripts/rooms/bench/configs/ablations/wider-seals.json

# Fresh execution for real latency measurements (bypass the prediction cache).
scripts/rooms/bench/run run --fresh --config scripts/rooms/bench/configs/opus-growth.json

# Final evaluation only. Sweeps on holdout are always refused.
scripts/rooms/bench/run run --suite holdout --allow-holdout --config scripts/rooms/bench/configs/opus-growth.json
```

To test a detector implementation change, edit `detect.ts` or the imported raster core
in YOUR worktree, then rerun. Hash changes invalidate affected predictions automatically.
No need to commit every experiment. Each result saves source snapshots and the Git HEAD
plus content hashes, so dirty experiments remain attributable. Existing app integrations
are never changed by this runner.

## What is measured

Current adapter receives the image plus known interior label locations, never the reference
polygons. This is **known-seed geometry evaluation**, not OCR or end-to-end PDF detection.
ResPlan seed points were generated from publisher polygons; scores therefore do not measure
label placement robustness. We keep text in raster inputs; unlike the PDF prototype, this
adapter cannot suppress text-layer rendering.

Ground truth is rasterized at the same resolution as the output. Reports include:

- Instance precision, recall and F1 at IoU 0.50 and 0.75, one-to-one maximum-cardinality matching.
- Matched IoU summed over ALL ground-truth rooms, with misses contributing zero.
- Potential merges (one prediction covers >=50% of two or more reference rooms).
- Potential splits (two or more predictions each cover >=15%, combined >=50%, of a reference).
- Per-case process time, detector time, peak RSS; median and p95 process time in summaries.
- Errors/timeouts with zero predictions and all reference rooms missed. These runs appear
  as **unranked**, never quietly excluded from the denominator.

Leaderboard order: no execution failures, then higher F1@0.5, then higher IoU/all reference
rooms, then lower median process time. This is an explicit default, not a product acceptance
rule; false merges can matter more than small F1 gains. Matching is not class/name-aware.

The configurations are research candidates, not production defaults. `opus-growth` adapts
Opus's prototype orchestration at this resolution; it is not a claim to reproduce the live
vector/PDF detector. The wall/door primitives themselves are imported directly.

## Comparison and cache rules

Comparisons require identical selected IDs, image/annotation/seed hashes, target, known-seed
mode, scoring implementation/dependency versions, resolution and timeout. Different detector
versions/configurations can be compared. Different suites/targets cannot be pooled.

Prediction caches include source and lockfile hashes, parameters, image, seed locations,
resolution, timeout, Node version and architecture. Cache files have integrity checks.
Annotation-only changes invalidate scoring comparisons; they need not rerun an unchanged
image/seed detector. Cache-hit timing values are historical execution values, NOT current
speed measurements. Use several `--fresh` repetitions on an otherwise idle machine before
claiming a speedup. No network or paid model calls are needed.

The 100 holdout cases were reserved during development; final evaluation is recorded in `HYBRID_RESULTS.md`. Near-duplicate protection
is limited by the upstream corpus; a reserved split is not proof of statistical independence.

## Add real drawings or suite targets

Prepare a PNG/JPEG of the exact drawing view plus manually reviewed annotations. Keep each
building/site wholly within development or holdout, including floors/crops/rotated variants.
Do not put private customer drawings into a public repository.

Pass `--manifest /path/to/cases.jsonl --corpus /path/to/files --target suite` for suite tests,
or omit `--target` for functional rooms. `smoke` deterministically picks 12 development
cases. `development` selects all development cases. All image paths resolve beneath corpus.

One manifest row (compute the actual image SHA256 and room count):

```json
{"id":"project-a-floor-2","family":"reviewed-project","target":"suite","split":"development","path":"plans/floor-2.png","sha256":"ACTUAL_IMAGE_SHA256","annotation_path":"annotations/floor-2.json","room_count":2}
```

Annotation contract:

```json
{"id":"project-a-floor-2","rooms":[{"name":"N201","seed":[0.2,0.3],"polygon":{"type":"Polygon","coordinates":[[[0.1,0.1],[0.4,0.1],[0.4,0.5],[0.1,0.5],[0.1,0.1]]]}}]}
```

The sample polygon illustrates the schema only; the manifest's count must match actual
annotations. Coordinates are normalized x/right, y/down. Polygon holes and MultiPolygon
are supported. Supply one interior seed per intended object. A **suite** outline and a
**bedroom** outline are different targets; never compare them in the same group.

MSD raw geometry and HABS scans are not yet scored by the default suite. They require
reviewed raster inputs/annotations meeting this contract. Colour-coded publisher ground-truth
previews must not be mistaken for original unlabelled detector inputs.

## Validate the harness

```sh
"${ROOM_BENCH_PYTHON:-/home/tim/datasets/foremanhq-room-detection/.venv/bin/python}" -m unittest discover -s scripts/rooms/bench -p 'test_*.py'
pnpm exec tsc --noEmit
```

The Python tests check exact/missing/extra/merged/split rooms, matching, polygon holes,
invalid inputs, stable/disjoint suites, comparison rejection, and cache invalidation.

## Combined candidate

`configs/hybrid.json` preserves enclosed regions and uses longer wall evidence to avoid
turning room-label lettering into solid walls. When several labels share a component,
it partitions that component with a weighted geodesic distance. Multiscale ink density
adds a soft crossing cost: long wall bands have full weight and raw darkness has 25%
weight. Blur radii are 0.0125 and 0.025 of the longer image dimension, combined 35%/65%.
The selected cost penalty is 20. Geometry boundaries remain hard constraints.

The baseline remains available unchanged in `configs/opus-growth.json`. The no-density
ablation keeps the same longer-wall and seed-partition changes but sets the cost penalty
to zero. Additional research configurations, including rejected watershed and wall-continuation approaches,
are under `configs/ablations/` and require explicit selection.

Output IDs are original seed indices plus one. Diagnostics now expose rejected/nudged
seeds, collisions, final areas and every inferred label-pair boundary. All inferred
boundaries require review; mean ink evidence and the fraction below 0.03 are heuristics,
not confidence probabilities. Unlabelled annexes previously grown from a contested core
are left unassigned instead of silently given to its first label. This conservative
choice is counted in `unassignedAnnexComponents`.

Many publisher references divide open-plan kitchen/living areas along lines that are
not drawn as walls. Recovering both functional labels does not prove the exact dividing
line. Known-seed F1 is not a safe acceptance gate for automatic production room saves.

The pixel partition uses O(N) working memory and O(M log M) time, where N is image pixels
and M is contested pixels. Use the runner's bounded resolution (1024 by default; maximum
2048 wide and 4096 tall). Do not drop this implementation directly onto 6000px PDF renders.
The app still needs text-layer exclusion, seed identity mapping, polygon extraction,
room/suite target handling, and reviewed real-sheet validation.

## Synthetic robustness checks

```sh
/home/tim/datasets/foremanhq-room-detection/.venv/bin/python scripts/rooms/bench/stress.py --count 12
scripts/rooms/bench/run sweep --suite development \
  --manifest /home/tim/datasets/foremanhq-room-detection/stress/manifest.json \
  --configs scripts/rooms/bench/configs/opus-growth.json scripts/rooms/bench/configs/hybrid.json
node --import tsx --test scripts/rooms/bench/*.test.ts
```

The generator creates padded 7-degree rotations with transformed references/seeds, mild
scan blur/noise, and six small wall gaps per selected drawing. It only opens development
source files and records transforms, random seeds, dependencies and checksums. These are
synthetic corruptions, not additional independent architectural drawings.

Every run checks detector source hashes before each case and after execution. If source
changes while a run is active, affected cases fail and their predictions are not cached;
the run becomes unranked. Finish a run before editing detector files.

The optional `rectilinearCut` ablation proposes straight cuts only at abrupt narrowings,
requires exactly two labels, a single continuous opening, nontrivial areas, and full
connectivity on both sides. It is disabled in the recommended config because stricter
outline and stress measurements regressed. Every proposed cut is explicitly inferred.
