# Promptable room-outline research — 2026-09-30

Official SAM 2.1 tiny is practical for local assisted outlining, but the tested pretrained model is **not approved for ForemanHQ's default tap-to-add behavior**. Corrective taps and rough boxes improve synthetic targets substantially. On the actual A511 drawing, it can also select furniture, merge adjacent rooms, fragment halls, and turn annotations into holes. A local runtime and repeatable interaction benchmark now exist; no production code or service was changed by this experiment.

## Primary sources and commercial usability

Meta's [official repository](https://github.com/facebookresearch/sam2) releases the code and checkpoints under [Apache 2.0](https://github.com/facebookresearch/sam2/blob/main/LICENSE). Its image predictor accepts positive/negative points, boxes and previous low-resolution masks. Tiny has 38.9 million parameters; this trial downloaded only its 148.7 MiB checkpoint. The official [predictor implementation](https://github.com/facebookresearch/sam2/blob/main/sam2/sam2_image_predictor.py) is the integration reference. These licensing facts make it a commercially usable candidate subject to the license's attribution/redistribution conditions; they do not establish domain accuracy. No third-party architecture-specific weights with noncommercial data restrictions were used.

The [SAM 2 paper](https://arxiv.org/abs/2408.00714) describes general promptable image/video segmentation. It does not establish architectural-room completeness. [Official training code](https://github.com/facebookresearch/sam2/blob/main/training/README.md) supports custom image training and simulated iterative prompts. Its published video fine-tuning recipe assumes 80 GB A100 GPUs; that recipe cannot be assumed to fit this 16 GB card. A frozen-encoder/decoder adaptation would need its own measured memory and accuracy experiment.

The project TypeSafe skill and [current state documentation](https://docs.typesafe.ai/concepts/state) were read. Jev currently accepts text/JSON, not images; it cannot supply this segmentation stage. No Jev or other paid inference was called, and no customer pixels were uploaded.

## Reproducible local setup

Harness: `scripts/rooms/promptable/`, with [setup and commands](../scripts/rooms/promptable/README.md). Isolated environment and official checkout are under `/home/tim/datasets/foremanhq-room-detection/promptable/`; the ongoing structural-model environment was not modified.

- Official source commit: `2b90b9f5ceec907a1c18123530e92e794ad901a4`, clean checkout checked at runtime.
- Tiny checkpoint SHA256: `7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69`.
- Actual runtime: Python 3.12.14, PyTorch 2.12.0+cu130, TorchVision 0.27.0+cu130, RTX 5060 Ti, bfloat16 inference.
- Four CPU threads, 20% CUDA process allocation cap, 30-megapixel image limit; no custom CUDA extension or automatic hole/sprinkle filling.
- Nine deterministic tests cover tap validity, selection without ground truth, positive/negative correction behavior, an L-shaped hallway, polygon holes/islands, diagonal pixel contacts with exact round-trip and rejection of protected splits/sites.

The protocol selects among SAM masks by prompt compliance and predicted IoU. Ground truth generates simulated human taps, viewport/box extents and stopping; it **never selects a candidate mask**. These oracle interactions are upper-bound assistance evidence. They are not comparable to automatic all-room recall and do not measure a user's time or tapping mistakes. Emitted valid polygons are scored separately from raw masks, with exact pixel-center round-trip required.

## Development interaction results

The separate whole-sheet context development corpus supplies four validation sheets from two sites (`1009`, `1019`), with six rooms per sheet sampled deterministically to include small, large and elongated regions. This small sample is exploratory. It excludes all sites reserved for the existing geometric development/holdout. No protected holdout record or label was opened. Targets and images are procedural MSD-derived nuisance sheets, not authentic construction scans.

The first mask run (`promptable/eval-tiny-dev-20260930/report.json`) measured:

| Simulated interaction | One-tap mean IoU | Final mean IoU, at most 5 taps | Final targets >= .85 | Mean taps |
| --- | ---: | ---: | ---: | ---: |
| Whole sheet | .563 | .884 | 16/24 | 4.79 |
| Intended-room viewport | .519 | .880 | 16/24 | 5.00 |
| Viewport + rough room box | .776 | .897 | 21/24 | 4.96 |

A fixed dark-ink morphological closure/flood baseline averaged .532 on the same first taps. This simple baseline is not the complete production detector. The tiny model's peak GPU allocation was 525 MiB; median shared sheet encoding was 44 ms. Median decoding was 42 ms for full-sheet native masks, about 3 ms for crop masks. Full experiment elapsed time was 158 seconds including CPU oracle-tap generation and private overlays. These timings exclude model/environment startup and browser/network work.

Three handcrafted fixtures measured closed room, open-door room and an unlabeled L-shaped hall with an island. Whole-sheet first/final IoUs were .965/.998, .933/.987, .720/.964, requiring 2, 3 and 5 taps. The hallway result shows corrective interaction can recover an unlabeled region on a simple input; it does not establish real construction hallway performance.

An initial polygon-scored replay (`promptable/eval-tiny-dev-emitted-20260930/report.json`) exposed an adapter failure: naive OpenCV pixel-center contours self-crossed at diagonal contacts, and strict validation dropped large crop components. That failure was not a model-accuracy finding. The final adapter unions exact pixel-edge row spans, validates topology/area conservation and rasterizes at pixel centers to assert exact equality with the model mask. It does not fill fixture/annotation holes, simplify, or invent room boundaries. The final replay and exact source/runtime provenance are in `promptable/eval-tiny-pixel-edge-20260930/report.json`. Earlier reports remain immutable for audit.

The final replay passed exact round-trip and area/topology checks for all **81 emitted masks** (24 development targets plus three fixtures, each under three interaction modes). Final emitted mean IoUs and >= .85 counts exactly match the table's raster values. Elapsed time was 160 seconds, peak GPU allocation 525 MiB, median full-sheet decoding 42 ms and crop decoding 3 ms. Geometry correctness of this conversion does not establish wall correctness of its input masks.

## Actual A511 findings

Source: private text-free 5000 x 3750 RGB raster; hash is recorded in the private probe report. Four human-authored targets exercise an upper bedroom, an open-door living area, common hallway and a small bathroom. Full-sheet tap, crop tap, crop with negatives, and crop with a rough box plus negatives were inspected. This floor has no fully annotated room ground truth, so no actual-sheet IoU, recall or completeness is claimed.

- A full-sheet living-area tap merges its neighboring bedroom into the same unit. A crop-only tap can instead select a small fixture rather than the intended room.
- A crop and rough box yield visually plausible bedroom/living/bathroom drafts, but annotation and fixture holes remain, and no professional review or wall-alignment accuracy has been measured.
- The common-hall tap selects a short callout-scale fragment. A tall rough box extends the draft along the corridor, but clips its horizontal branches, creates many tiny fragments and excludes annotation pixels. This is insufficient for a correct connected hallway.
- Negative taps can degrade a reasonable room draft into a smaller object. Estimated model scores are not reliable room-selection confidence in this domain.
- The naive contour adapter could emit no valid polygon despite a plausible raster. Its replacement conserves the mask exactly, including unwanted annotation fragments and holes; valid geometry alone does not establish a correct room.

The rough-box corridor output contains 92 disconnected polygons and 4,359 vertices, further showing why this raw draft is unsuitable for a single-room production adapter. Tiny symbol fragments are preserved intentionally in this experiment so their errors remain visible.

Final private qualitative report/overlays: `/home/tim/datasets/foremanhq-room-detection/promptable/a511-tiny-pixel-edge-20260930/`. Human-authored probe coordinates are in private `a511-taps.json`. Nothing is stored in the production database.

## Recommended next experiment

Keep explicit tracing and per-room approval as the reliable editing path. Before exposing SAM assistance, build a **prompted real-sheet editing benchmark** from reviewed complete floors: job-disjoint development/holdout, small bathrooms/closets, merged units, open doors, unlabeled halls with branches/islands, fixtures and annotation interference. Measure single-tap success, clicks needed to reach usable valid wall-aligned geometry, failed drafts, editing time versus tracing, and drawing-version provenance. Use multiple tap positions and noisy rough boxes, not only oracle maximum-clearance taps. Preserve valid connected corridor holes; furniture/callout holes must be distinguished using native wall evidence or learned domain cues, not indiscriminate hole filling.

A bounded frozen-encoder/mask-decoder adaptation on development-only room instances and exact reviewed corrections is the next concrete model trial. Prompt sampling should include positive taps across connected branches and negative taps in adjacent rooms; unknown regions on partially reviewed sheets must remain unknown. Compare it against this untouched pretrained baseline and manual tracing. Expensive larger weights or automatic dense point grids should not be substituted for that test: a prompted improvement cannot prove every physical room is automatically discovered. Promote only after the measured real-sheet editing and geometry checks pass.
