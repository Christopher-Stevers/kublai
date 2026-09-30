# True physical-opening model challenger — 2026-09-30

The new model adapts well to generated physical wall/door targets, but **fails the actual A511 visual check and remains rejected for production**. No model was enabled in ForemanHQ. The one authorized trial uses original Swiss Dwellings wall, window, door and fixture geometry. The source has no independently certified physical-room completeness. Consequently this experiment measures **masked pixel heads only**, and its actual A511 check is qualitative.

## Frozen experiment

The renderer and source preflight are described in [the source report](ROOM_TRUE_OPENING_DATA_2026-09-30.md). Original [Swiss Dwellings v3](https://zenodo.org/records/7788422) is CC BY 4.0. The model uses independently rendered RGB images; original construction drawing images are unavailable. Door coordinates are genuine, while door-swing orientation, drawing style, some furniture and stair treads are simulated.

The v4 dataset is 80 training and 20 development pages from 100 disjoint site/alias components. All 173 sites used by the protected geometric corpus, both previous model datasets and the completed once-only generalization check are excluded before geometry decoding by the separately audited builder. No protected or once-only pixel data is opened here. v4 changes the ink only: all source identities, splits, target arrays, overview arrays and functional references remain byte-identical to preserved v3. Nine declared styles include gray walls at 180/220, paired white or gray outlines, and bounded furniture/stair clutter.

Dataset: `/home/tim/datasets/foremanhq-room-detection/models/data-swiss-true-openings-v4-20260930/manifest.json`

SHA-256: `619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b`

The native targets have three heads:

| Head | Supervised target |
|---|---|
| Interior | Known indoor source-area union minus physical footprints, unknown areas and explicit nonrooms |
| Boundary | Actual WALL/COLUMN and WINDOW/DOOR/ENTRANCE_DOOR footprints |
| Opening | Actual DOOR/ENTRANCE_DOOR footprints |

Six cases have unknown pixels. Every loss and score masks them out, including 3,638 positive door pixels with `known=0`. Unknown is neither positive nor negative supervision. The unchanged training sampler can still center a tile on an unknown opening; this default limitation is retained and declared. Targets' provisional connected-component `truth` arrays are never opened for matching or completeness scoring.

Compatibility was verified against the unchanged `models/context_train.py`, then 21 model source files were copied byte-for-byte into a private execution snapshot. One random-initialized context U-Net trial uses exactly the previous long model's architecture/defaults: 2,456,454 parameters, base 16/context base 8, 512-pixel native tile/overview, batch 2, four patches/page, AdamW at .001, seed 20260930, four threads, bf16 CUDA, masked weighted BCE/Dice, local loss plus .5 overview loss, 48 epochs. The checkpoint is the minimum development-loss epoch; there is no hyperparameter search or second trial. CUDA grid-sample backward prevents a promise of bitwise repeated training despite fixed seeds.

The old comparator is the frozen long48 checkpoint `aaa9990485a71a93406bf84ed21871f20721b0981c069247928c379633dd8313`. It learned derived centerlines and arbitrary synthetic wall gaps. **Its lower score against new physical footprint targets would show target-contract mismatch, not a fair room-accuracy ranking.** Neither model's generated pixel scores establish real-room completeness.

## Execution and measurements

Private trial directory: `/home/tim/datasets/foremanhq-room-detection/models/train-swiss-true-openings-v4-20260930`

The trial completed once, in 592.45 seconds, with peak allocated CUDA memory 1,434.33 MiB on RTX 5060 Ti 16 GiB. The selected epoch is 47, development loss .41843582. All completion/config/source/runtime/asset checks passed. The paired native-head check completed once on all original 20 development pages, at probability .5, tile 512 / overlap 128 / overview 512 with unchanged interior fusion. Each head has 62,503,897 known pixels; 410,663 unknown pixels are excluded. The two methods' target/known totals match exactly. No independent test or new-site score is being asserted.

| Known-pixel metric | Frozen long48 | New true-opening48 |
|---|---:|---:|
| Interior IoU | 44.15% | 92.40% |
| Boundary IoU | 40.02% | 86.38% |
| Opening IoU | 1.88% | 61.71% |
| Interior precision / recall | 72.68% / 52.94% | 93.59% / 98.64% |
| Boundary precision / recall | 80.14% / 44.43% | 87.70% / 98.29% |
| Opening precision / recall | 32.67% / 1.96% | 71.50% / 81.84% |

These are **pixel-head** precision/recall against the new footprint contract, never room-instance recall or whole-floor success. No room F1, missed-room rate or floor completeness is computed from the source's algorithm-derived components. The model still has 74,935 false positive and 41,706 missed known opening pixels. Head learning has not solved topological completeness.

The predeclared style breakdown also exposes weaker cases: new opening IoU is 39.29% on three paired-white-1 pages and 46.43% on the single paired-gray-2 page. New interior IoU on the two solid-180 pages is 78.50%, compared with the aggregate 92.40%. These small development groups are diagnostics, not independent generalization evidence, and triggered no tuning. Eight of the nine training styles occur in the development split.

Paired scoring took 21.45 seconds for old and 22.25 seconds for new, each peak allocated 202.92 MiB, including inference/cache/scoring overhead measured by the adapter. The two methods use identical images and target bytes.

| Immutable private evidence | SHA-256 |
|---|---|
| Training `binding.json` | `3a0d95399efec41a86c6d9b1de2362ad7d6af139dcadacd01480d5b1e93b8d69` |
| Training `training/run.json` | `ae03141eb308d6f7ceff8e1b05dcf41196b7ab39f6461578407360ec6b2e1169` |
| Selected `training/best.pt` | `6e2be29bac8fadce06b103e93e08e4bc32d3e79a7b9258217edc5cb87dcb3aa4` |
| Paired `report.json` | `234cf11f7ee7f67509340f85b556bb37affbf676cc3afda9b0b33b9551fadf85` |

Paired directory: `/home/tim/datasets/foremanhq-room-detection/models/eval-swiss-true-openings-v4-20260930`. Training and paired directories each preserve executed source snapshots and all input/runtime/claim/cache bindings. The independent evidence audit recomputed per-case, aggregate and style confusion counts and verified every raw cache/asset byte hash without decoding protected data.

## Fixed actual-sheet falsification

Input is the clean text-free 5000×3750 RGB A511 page, SHA-256 `0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828`. It contains no colored detector overlays. The new checkpoint is evaluated once at the declared plain boundary .4/interior .35/minimum 25-pixel operating point, then its same cached probabilities enter the already selected `hierarchical_basins` partition. The existing partition core SHA-256 is `49cfc8ea71eadab40428801beb260e7dd03262422233bdf5ae0dc7278fd3d713`; it is unchanged. Inferred model structure supplies markers; no reference room counts, labels or crops supply seeds.

The private probe includes valid normalized polygons/holes, plain and hierarchical overlays, native labels and probability previews. The hierarchical exporter preserves exact pixel-cell area, narrow corridors and holes. Visual rejection criteria include missed wings/rooms, unit or hallway merges, invented partitions, giant exterior components, and parking/titleblock false rooms. There is no independent complete A511 room reference, so proposal counts cannot establish room precision, recall or perfection.

Plain inference plus polygonization emitted 543 proposals in 9.15 seconds (peak allocated 201.42 MiB). Fixed hierarchical partition/export/overlays emitted 395 proposals with 2,079 holes in 11.99 seconds. Its largest polygon covers 867,157 native pixels, 4.62% of the whole page. These proposal/geometry diagnostics are not reference room counts.

Visual inspection shows broader structural coverage in both wings and the north strip than the old long48 model, but obvious failure:

- Plain output still fragments or merges interiors and interprets revision-cloud/fixture loops as holes or boundaries.
- Hierarchical output invents many central parking-stall/annotation divisions and fills exterior areas at the left, right and bottom of the plan.
- The right perimeter/titleblock region gains large false proposals. Many holes follow furnishings or revision markup instead of room exclusions.

Both operating points are rejected. No parameter change, repeat inference, retraining or production promotion followed this qualitative check. Independent real-floor geometry is still needed before claiming how many physical rooms were missed, merged or split.

Private probe directory: `/home/tim/datasets/foremanhq-room-detection/models/a511-swiss-true-openings-v4-20260930`

Inspect `plain-overlay-preview.png`, `hierarchical/overlay-preview.png` and `interior-probability-preview.png` alongside `boundary-probability-preview.png`/`opening-probability-preview.png`. Full-resolution overlays and exact hierarchical polygons/labels are also preserved.

| Actual private evidence | SHA-256 |
|---|---|
| `probe_binding.json` | `cad904708ae08d34a1d9d7f86600b47d1f8b7868e60e1e634f9c1c15a8642fe6` |
| `probabilities.npz` | `a3275485370d377e932a6064a46bf600eeb9a7e53c18439910b6e91871a993d4` |
| `plain.json` | `206e73133be72c98ae416d838b8ff246e066fde587b4fa1193c9856ec8e498ca` |
| `hierarchical/prediction.json` | `98aed52aedb1f8ff2bf58266a4eb214b4bed5a390f1f2c6d0b52325d4350e370` |
| `hierarchical/completed.json` | `b3138b74c9addf6ef04fce98dca0f32ab79d3de165fb1acb7bea45bcf054f453` |

## Byte and review safeguards

Training, paired head scoring and actual probing each have a separate original-path attempt claim. Changing an output directory cannot create another attempt. Bindings pin source/runtime/data/checkpoint identities before work and recheck them after decoding, loading, inference and final output. Checkpoint consumption requires all 48 epochs, exact defaults, matching source/data/runtime metadata and the actual minimum-loss selected epoch. Emitted maps/labels/JSON/overlays are hashed immediately and rechecked at completion; copied actual directories and missing input/model bindings are rejected. All weights/images/caches remain outside Git.

The model GPU runtime is the existing Python 3.12.14/Torch 2.12.0+cu130/CUDA13 environment, with NumPy 2.5.3 / Pillow 12.3.0 / SciPy 1.18.1 / Shapely 2.1.2 / OpenCV 5.0.0.93. The fixed watershed runs in the existing separate CPU runtime with scikit-image 0.26.0, without modifying the model runtime. Executable commands and fabricated test commands are in [the adapter README](../scripts/rooms/swiss-model/README.md).

The next meaningful source of completeness evidence is an independently corrected, current-hash real floor: approve accurate proposals, reject inaccurate proposals, add missed spaces and correct boundaries, then attest the complete floor. The already tested context review adapter can represent partial positives with unknown everywhere else; a rejection alone is never background, and partial floors are excluded from all-room scoring. This Swiss-only trial does not train on unverified production reviews or convert functional areas into certified physical rooms. Mixing verified real drawings would be a separately declared experiment.

Eighteen fabricated adapter tests cover original-path claims, exact completed-run/checkpoint selection, post-decode mutation, unknown supervision and zero gradients, exact case coverage, mandatory input/model hashes, copied/preset/source-mismatched probes, emitted map/overlay drift and hole-preserving exports. Model/partition production code and previous frozen scoring sources remain untouched. The remaining direction is real-drawing boundary/ROI evidence, with annotation review of parking lines, revision clouds and fixtures, rather than assuming generated-head success establishes actual room completeness.
