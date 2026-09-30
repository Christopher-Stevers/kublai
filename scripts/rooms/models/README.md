# Local structural-model challenger

This executable experiment trains an own compact U-Net with RGB inputs and three heads: interior, room boundary and opening closure. It keeps color cues, proposes unlabeled rooms, blends overlapping tile probabilities before global polygon extraction, and retains corridor holes. It is separate from the production detector. Every model/output is explicitly unapproved; sigmoid scores are not calibrated confidence.

The generated inputs include thin/gray walls, simulated door gaps with leaf/arcs, fixtures, text, repeated stair treads, section bubbles, dashed grids and colored revision clouds. They are procedural simulations of ink, **not original construction drawings**. Better loss on these inputs does not establish ForemanHQ accuracy.

## Tested runtime and commands

Python 3.12, PyTorch 2.12.0+cu130 and an RTX 5060 Ti (16 GiB) passed an actual CUDA operation on this machine. Use an isolated environment outside the repository; the CUDA wheel index is deliberate for the Blackwell GPU. Do not copy old CUDA 11.x research setup recipes.

```bash
python3.12 -m venv /absolute/local-model-venv
/absolute/local-model-venv/bin/pip install torch==2.12.0 --index-url https://download.pytorch.org/whl/cu130
/absolute/local-model-venv/bin/pip install -r scripts/rooms/models/requirements.txt
```

The environment here is `/home/tim/datasets/foremanhq-room-detection/models/.venv`. If using `uv`, call its installed binary when the user's shim has no configured default; do not change system defaults for this experiment.

Run deterministic tests:

```bash
/absolute/local-model-venv/bin/python -m unittest discover -s scripts/rooms/models -p 'test_*.py' -v
```

Generate a private training/validation dataset. The exclusion input is the **entire existing all-spaces evaluation manifest**: both development and holdout sites are excluded, including their other floors. The new model validation is also grouped by site. Output must be a new directory; inputs/targets receive hashes and remain outside Git.

```bash
/absolute/local-model-venv/bin/python scripts/rooms/models/build_data.py \
  --msd /absolute/corpus/msd/floors.jsonl \
  --protected-manifest /absolute/corpus/all-spaces-msd/manifest.json \
  --output /absolute/private-model-data \
  --train 80 --validation 20
```

`build_data.py` generates synthetic data only. Its legacy `--feedback` path has been removed. Use the [verified context review adapter](#context-adaptation-from-verified-reviews) for real annotations; it applies whole-PDF exclusion and split guards before resolving private review assets.

Train locally and save a real checkpoint selected by new validation loss:

```bash
/absolute/local-model-venv/bin/python scripts/rooms/models/train.py \
  --manifest /absolute/private-model-data/manifest.json \
  --output /absolute/private-model-run \
  --epochs 8 --tile 512 --batch 2 --patches 4
```

Training records seeds, data/source/checkpoint hashes, architecture, parameter count, runtime, losses, elapsed time and peak GPU allocation. It stops if source or manifest changes. Seeds and cuDNN deterministic mode are used; cross-hardware bit equality is not claimed. Best validation loss is a checkpoint selection rule, not evidence of complete room detection.

Compare on the new site-disjoint model validation using one-to-one instance IoU, missing/extra rooms and merge/split diagnostics:

```bash
/absolute/local-model-venv/bin/python scripts/rooms/models/evaluate.py \
  --manifest /absolute/private-model-data/manifest.json \
  --checkpoint /absolute/private-model-run/best.pt \
  --output /absolute/private-model-evaluation \
  --limit 20 --geometry
```

`--geometry` invokes the existing no-seed offline detector on the exact same nuisance images. It requires Node and repository dependencies. All compared source hashes are frozen for the run. Partial reviewed floors cannot enter full-space evaluation. This command never opens the protected all-spaces holdout.

Produce a bounded local prediction:

```bash
/absolute/local-model-venv/bin/python scripts/rooms/models/predict.py \
  --image /absolute/local-drawing-image.png \
  --checkpoint /absolute/private-model-run/best.pt \
  --output /absolute/private-model-prediction
```

The output contains `prediction.json` (normalized polygons and metadata), `labels.i32` (little-endian row-major integer labels, zero background) and `probabilities.npz` (three global maps). Inference has a 30-megapixel input limit, controlled overlap, native coordinates, explicit thresholds and preserved holes. No external API, authentication secret or database connection is needed. A deployment adapter must add GPU admission/deadlines/status; these scripts deliberately do not modify runtime services.

## Data and promotion rules

MSD JSON geometry is [CC BY 4.0](https://zenodo.org/records/17294451): cite Wassim Jabi's JSON release and the underlying [MSD benchmark](https://github.com/caspervanengelenburg/msd). Store source license/citation with generated artifacts. Reviewed customer drawings and derived images remain private. No CubiCasa/LIFULL data or pretrained weights are used in this experiment.

Do not train on the protected MSD evaluation sites or protected review jobs, relabel rejected merged proposals as empty space, silently treat unchecked floors as complete, or replace production based on synthetic loss. New geometry/model comparisons should measure real-sheet recall, false rooms, small-space/corridor recall, full-floor completeness, editing time and runtime failures. Completely annotated projects must remain unseen during training and threshold choice.

Large data, environments, checkpoints and probability maps belong outside Git. Only harness code, tests, reproducible commands and concise measured reports belong in the repository. See [the model research report](../../../docs/ROOM_DETECTION_MODEL_RESEARCH_2026-09-30.md) for alternatives and the limits of existing pretrained models.

## Whole-sheet context experiment

The separate `whole-sheet-context-v2` model combines a 512-pixel RGB overview with coordinate-aligned native-resolution local tiles. A single overview pass supplies structure/interior cues to the tile network. Global polygonization follows blended native wall/opening probabilities; the declared interior score is the mean of local and overview cues. The v1 architecture and checkpoint stay replayable.

`build_sheet_data.py` composes layouts from the same site into multiple wings and leaves explicit courtyards/background. It adds closed sheet frames/title boxes, parking dividers, grid bubbles/dimensions and revision/landscape curves as nonroom targets. Wall thickness/contrast, paired wall faces, original simulated door gap/leaf/arcs and page sizes vary. These are synthetic nuisance examples, not a faithful original drawing corpus. It excludes the same entire protected MSD site set and splits all constituent layouts together.

```bash
/absolute/local-model-venv/bin/python scripts/rooms/models/build_sheet_data.py \
  --msd /absolute/corpus/msd/floors.jsonl \
  --protected-manifest /absolute/corpus/all-spaces-msd/manifest.json \
  --output /absolute/private-sheet-data --train 80 --validation 20

/absolute/local-model-venv/bin/python scripts/rooms/models/context_train.py \
  --manifest /absolute/private-sheet-data/manifest.json \
  --output /absolute/private-context-run --epochs 12 --tile 512 --batch 2 --patches 4

/absolute/local-model-venv/bin/python scripts/rooms/models/context_evaluate.py \
  --manifest /absolute/private-sheet-data/manifest.json \
  --checkpoint /absolute/private-context-run/best.pt \
  --pilot-checkpoint /absolute/private-model-run/best.pt \
  --output /absolute/private-paired-evaluation --limit 20

/absolute/local-model-venv/bin/python scripts/rooms/models/context_predict.py \
  --image /absolute/local-drawing-image.png \
  --checkpoint /absolute/private-context-run/best.pt \
  --output /absolute/private-context-prediction
```

The paired comparison scores the same new validation pixels with context, frozen v1 weights and existing geometry. It rejects overlap between these validation sites and v1 training. Training verifies every asset before/after decode, then uses private immutable in-memory snapshots. Input group aliases cannot hide site overlap or identical image/target bytes across splits. Thin coarse boundaries survive overview downsampling; unknown pixels stay unknown. Polygon exports validate topology and preserve narrow connections/holes rather than silently scoring masks whose emitted shapes are invalid.

CUDA `grid_sample` backward can be nondeterministic even when cuDNN deterministic flags are set. Identical seeds/source/data are recorded, but bit-identical repeated context training is not promised. Compare emitted checkpoints and final room-instance results, not merely similarly named runs.

Actual construction-sheet testing has no quantitative completeness metric until every floor space has been reviewed. The first v1 pilot already demonstrates why synthetic scores are insufficient: its native 5000-pixel A511 output creates a giant background proposal and hundreds of symbol/landscape proposals, while resized inputs still merge apartment rooms. All weights remain unapproved. Consult the measured report before interpreting a later loss or score as progress.

## Native wall and portal challenger

`hybrid_native.py` supplements learned barriers with long achromatic native line strokes and paired wall faces near the learned structure/interior prior. It retains existing learned diagonal and colored barriers. Collinear portal additions require connected solid leaf/quarter-swing evidence, including paired double swings; plain openings and disconnected sampled dots do not qualify. This H/V supplement does not rescue diagonal walls, and achromatic evidence excludes genuine colored structural ink. Dashed door arcs can fail connectivity and need a separate evaluated policy.

```bash
/absolute/local-model-venv/bin/python scripts/rooms/models/hybrid_evaluate.py \
  --manifest /absolute/private-sheet-data/manifest.json \
  --checkpoint /absolute/private-context-run/best.pt \
  --paired-report /absolute/private-paired-evaluation/report.json \
  --output /absolute/private-native-ranking

/absolute/local-model-venv/bin/python scripts/rooms/models/hybrid_predict.py \
  --image /absolute/local-drawing-image.png \
  --context-prediction /absolute/private-context-prediction \
  --ranking-report /absolute/private-native-ranking/report.json \
  --output /absolute/private-native-prediction

/absolute/local-model-venv/bin/python scripts/rooms/models/overlay.py \
  --image /absolute/local-drawing-image.png \
  --prediction /absolute/private-native-prediction \
  --output /absolute/private-native-visual
```

The actual probe must use the development-ranked preset, exact same context checkpoint/input hash and unchanged native code. An optional `--probability-cache /absolute/prior-native-ranking` reuses verified context maps for a new native-only ranking; it excludes cached model time and records that fact. The paired reference is a historical immutable report, with its own geometry source fingerprint retained; it is not claimed to be a fresh execution of current geometry. Model/scoring/threshold/overlap compatibility is checked. The initial native experiment reduced merges but substantially increased false spaces and was rejected.

## Once-only unseen synthetic sites

`context_generalization.py` may run only after development comparison and explicit candidate selection. It excludes the union of all 89 protected geometric sites and every pilot/context training **and validation** site. The new contract is rejected by both training readers. It uses the same sheet renderer, one page per distinct new site, and records input/target hashes before scoring. Selection fixes the checkpoint, inference sources, development report and settings. Defaults are boundary .5, interior .35, minimum area 25, overlap 128, and pixel diagnostics .5; an explicitly scored ROI operating point pins its exact declared boundary/support/area/core settings. Completed development case IDs must cover the entire context validation split.

Plain context is pinned by omitting both preset flags; a declared native preset requires its completed native development report and `--native-preset NAME`. A scored point in the six-preset ROI table uses its completed report and `--roi-preset NAME`. `baseline_low_barrier` explicitly replays the .4 barrier operating point without clipping occupancy. Unscored native/ROI combinations are rejected. Finish all source edits and candidate comparisons before running these commands.

```bash
# Selection parent must already exist and be private.
/absolute/local-model-venv/bin/python scripts/rooms/models/context_generalization.py freeze-selection \
  --development-report /absolute/completed-development/report.json \
  --checkpoint /absolute/selected-run/best.pt --output /absolute/private-selection/selection.json

/absolute/local-model-venv/bin/python scripts/rooms/models/context_generalization.py build \
  --selection /absolute/private-selection/selection.json --checkpoint /absolute/selected-run/best.pt \
  --msd /absolute/corpus/msd/floors.jsonl --protected-manifest /absolute/corpus/all-spaces-msd/manifest.json \
  --pilot-manifest /absolute/data-pilot-v2/manifest.json --context-manifest /absolute/data-context/manifest.json \
  --output /absolute/private-once-only-corpus --cases 20

/absolute/local-model-venv/bin/python scripts/rooms/models/context_generalization.py evaluate-once \
  --manifest /absolute/private-once-only-corpus/manifest.json --checkpoint /absolute/selected-run/best.pt \
  --output /absolute/private-once-only-report
```

The selection-scoped `GENERALIZATION_BUILD_STARTED` marker binds the original resolved corpus and selection paths, preventing copied corpora/selections from bypassing the one-time policy. Both selection-scoped `GENERALIZATION_EVALUATION_STARTED` and corpus-scoped `EVALUATION_STARTED` markers permit one attempt, including a failed attempt, and are written before target/image decoding. Symlink aliases resolve to the same binding and markers. Do not remove markers or use exposed sites for tuning/rescoring. Reports include full-room instance matching, fixed per-head diagnostics, optional current geometry comparison, source/dependency fingerprints and actual runtime versions. This remains a synthetic generalization measurement, not a production or real-sheet completeness claim.

## Context adaptation from verified reviews

`context_review_data.py` copies the original synthetic context dataset byte for byte, preserving its split, and appends current version-2 private reviewed floors grouped by job. Metadata preflight across all exports collects every protected PDF before any review asset is resolved; all development aliases of that PDF, including other pages/jobs/previews, are quarantined. An admitted exact PDF cannot occur in both model splits. Private provenance records protected source pages, PDF exclusions and skipped aliases. Partial positives require current approved shape evidence against the exact copied PDF hash; source page, image dimensions and PDF/image preparation provenance are required. Approved interiors teach boundary negatives. All unchecked/rejected regions and every opening label remain unknown; dense first-head supervision requires current `complete_floor` attestation. Dense duplicate/nested/overlapping physical instances are quarantined before rasterization; one native pixel per boundary is tolerated and legitimate corridor holes are retained. Partial rows carry `full_space_evaluation_eligible=false` and are excluded from context full-space evaluation before applying a case limit.

```bash
/absolute/local-model-venv/bin/python scripts/rooms/models/context_review_data.py \
  --manifest /absolute/frozen-data-context/manifest.json \
  --feedback /absolute/private-current-review-export/feedback.json \
  --output /absolute/new-private-reviewed-context-data
```

The new private output retains exact source PDF, original preview, export and base-manifest copies with source/target/overview/runtime hashes. Mutated inputs, duplicated current floor exports and identical images crossing splits abort the build. This command does not invoke training, scoring, a database or a provider.

Training uses the verified export preview and its declared preparation; this is not automatic native production PDF preprocessing. Train a new private challenger explicitly with `context_train.py --manifest /absolute/new-private-reviewed-context-data/manifest.json --output /absolute/new-private-run`. Complete reviewed projects still need independently held-out project evaluation before any promotion.

## Fixed ROI and area tradeoff experiment

`roi_evaluate.py` compares exactly six declared hypotheses on the original complete development pages: normal .5/.4 barriers, bounded interior support at each, and bounded page-scaled area/core gates. It reports one-to-one matches, misses/extras/merges, zero-missed-floor rates and descriptive baseline rejection associations. Occupancy clipping cannot supply missing internal wall evidence and can create a giant merged building wing; small-area/core gates can remove genuine closets or halls. Actual probes are qualitative and remain unapproved.

```bash
/absolute/local-model-venv/bin/python scripts/rooms/models/roi_evaluate.py \
  --manifest /absolute/frozen-data-context/manifest.json --checkpoint /absolute/selected-run/best.pt \
  --paired-report /absolute/completed-paired/report.json --output /absolute/private-roi-table

/absolute/local-model-venv/bin/python scripts/rooms/models/roi_predict.py \
  --image /absolute/local-drawing-image.png --context-prediction /absolute/private-context-prediction \
  --development-report /absolute/private-roi-table/report.json --preset baseline_low_barrier \
  --output /absolute/private-roi-probe
```
