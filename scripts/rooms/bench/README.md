# Room detection development loop

Offline file-input benchmark of the raster primitives in `src/server/rooms/raster-rooms.ts`.
Does not import app/database/auth modules, load `.env`, call AI services, or modify real jobs.
The live site and Opus's checkout are not involved.

## Start here

From this worktree:

```sh
scripts/rooms/bench/run sweep
```

This compares the three checked-in configurations on a fixed 12-case smoke suite.
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
scripts/rooms/bench/run sweep --configs scripts/rooms/bench/configs/baseline.json scripts/rooms/bench/configs/wider-seals.json

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

Three starter configs are examples, not optimized production defaults. `opus-growth` adapts
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

The 100 holdout cases have not been run during harness development. Near-duplicate protection
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
