# Local structural room-model experiments

These are measured development experiments from 2026-09-30. No checkpoint is approved for production. No customer drawing was uploaded, no paid provider was called, and no existing protected MSD holdout was opened or retuned. Large data, checkpoints and private drawing overlays remain outside Git.

The executable harness is [scripts/rooms/models](../scripts/rooms/models/README.md); alternatives/licensing are documented in [the research decision](ROOM_DETECTION_MODEL_RESEARCH_2026-09-30.md). The machine used Python 3.12, PyTorch 2.12.0+cu130 and an RTX 5060 Ti with 16 GiB. The original v1 sources are archived beside its private checkpoint; `network.py` and `common.py` remain unchanged so its weights can be replayed.

## V1: simulated layout ink

An own 1,964,131-parameter RGB U-Net predicts interior, boundary and virtual opening closure. Inputs include random thin/gray walls, door gaps/connected leaf/arcs, text, fixtures, stairs, grid/section bubbles and colored revision clouds. Its room targets come from commercially usable MSD JSON geometry. These are simulated images, not original construction sheets.

Training used 80 layouts from 22 sites and development validation used 20 layouts from five other sites. All 89 sites occurring anywhere in the existing all-spaces MSD development/holdout manifest were excluded before tiling/rendering. Eight epochs, 512-pixel tiles and batch two took **108.49 seconds**, using **980.45 MiB** peak CUDA allocation. Epoch eight had the lowest validation loss.

Paired comparison on the exact same 20 new validation images, containing 698 reference spaces:

| Method | Recall at IoU 0.5 | Precision at IoU 0.5 | F1 at IoU 0.5 | F1 at IoU 0.75 | Misses | Extra spaces | Merges / splits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Structural v1 | 87.25% | 95.75% | 91.30% | 74.66% | 89 | 27 | 16 / 2 |
| Existing geometry, no seeds | 43.12% | 73.41% | 54.33% | 46.39% | 397 | 109 | 50 / 6 |

Both methods had zero adapter failures. Model median inference/postprocessing time was 130 ms; geometry median was 1,242 ms. Model loading was excluded and geometry included Node startup, so this is **not** a fair standalone service-speed ratio. F1 falling at IoU 0.75 shows meaningful boundary errors remain even in the simulated domain.

## Actual A511 falsification

The frozen v1 checkpoint was run on the actual clean RGB, text-free 5000×3750 A511 image. This input contains no detector overlay. The result was **436 proposals, 61 with holes**, taking **6.45 seconds** with **186.47 MiB** peak CUDA allocation. No complete reference annotation exists, so these counts cannot be interpreted as precision or recall.

Visual inspection rejects promotion. A closed sheet frame creates a giant background proposal that leaks into many east-side rooms. Dimension bubbles, parking stripes and landscape outlines create false spaces. West-side apartment rooms remain merged. Real walls, fixtures and openings differ substantially from the simulated source, and native 5000-pixel tiles see much less building context than the 1024-pixel training layouts.

Read-only scale diagnostics with unchanged weights/thresholds produced 50 proposals at width 1024 and 144 at width 2048. The giant sheet-background proposal disappeared at those scales, but merged apartment interiors and landscape false positives remained. Resizing therefore explains part of the failure and does not establish a solution. All three outputs stay private diagnostic artifacts.

## V2: whole-page context and native detail

The separate 2,456,454-parameter experiment conditions local native-resolution RGB tiles on coordinate-aligned cues from a 512-pixel RGB page overview. It computes one overview per page, blends local probabilities into one page graph, preserves polygon holes, and uses the declared mean of local and overview interior scores. It retains native-resolution wall/opening boundaries. This targets white-room/background ambiguity without assuming every enclosure is a room.

New simulated pages compose two or three layouts from the same site into multiple wings, leaving explicit courtyards/background. Closed sheet frames/title boxes, parking dividers, dimension bubbles/grids, revision/landscape curves, paired wall faces and contrast/scale jitter are deliberate nuisances with nonroom targets. Door leaf/arcs remain connected to simulated wall gaps, and closed room geometry supplies the virtual closure target. Page widths vary from 1536 to 4096. Anisotropic resizing and nuisance primitives are augmentations, not original engineering drawing semantics.

The new dataset contains **80 training pages from 30 sites and 20 validation pages from seven other sites**, again excluding all 89 protected sites. Every constituent layout follows the site's split. Twelve epochs took **174.95 seconds**, using **1,434.33 MiB** peak CUDA allocation. Validation loss fell to 0.7996 at epoch 12; this different objective/data is not comparable to the v1 loss or a room-completeness score.

Paired scoring on all 20 new development pages, containing 1,321 reference spaces:

| Method | Recall at IoU 0.5 | Precision at IoU 0.5 | F1 at IoU 0.5 | F1 at IoU 0.75 | Misses | Extra spaces | Merges / splits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Context v2 | 76.53% | 74.39% | 75.45% | 59.25% | 310 | 348 | 62 / 20 |
| Frozen structural v1 | 78.73% | 55.47% | 65.08% | 46.56% | 281 | 835 | 42 / 14 |
| Existing geometry, no seeds | 50.11% | 74.80% | 60.02% | 46.69% | 659 | 223 | 58 / 26 |

All adapters completed without failures. Model medians were 1,221 ms (v2) and 1,086 ms (v1); geometry was 5,962 ms including process startup. V2 reduces false positives but loses some recall and has more merges than v1 on these pages. Validation selects checkpoints and ranks development ideas; it does not replace an unseen-project real-sheet test.

Fixed-threshold pixel diagnostics expose the next problem. V2 interior IoU is 91.87% (recall 96.40%, precision 95.14%). Boundary recall is 93.10% but precision only 51.91%. Opening-closure recall is 44.11%, precision 13.02%, IoU 11.18%. Room topology is much less successful than interior occupancy: high pixel overlap can coexist with missed/merged rooms.

Native A511 v2 inference using the exact frozen training/prediction sources produced **191 proposals in 7.35 seconds**. It eliminates v1's giant sheet-frame background and major parking/landscape proposals. It still merges apartment interiors and north washrooms, misses multiple lower-west/east rooms, and creates small symbol/fixture/title-text fragments. Both overview and local interior maps include many missed spaces, while the native internal gray boundaries and portal closures are weak. This is a wall-partition failure rather than proof that more interior training alone will fix it. Quantitative real-sheet recall remains unknown. **V2 is rejected for promotion.**

## Native wall/portal challenger

A separate offline challenger retains the learned sheet/interior prior and supplements it with long achromatic native wall strokes and nearby paired wall faces. It preserves existing learned diagonal/colored barriers, instead of assuming all colored ink is nonstructural. Declared presets bound collinear gap size; a quarter-swing arc and connected hinge leaf must span a gap before it is repaired. A plain opening or disconnected ornamental circle is not closed. Generated centerline targets share the rendered wall coordinates; paired-face targets sit between those faces. Reviewed outlines do not certify a physical wall or door class.

The first native preset run was worse than v2. Best `native_walls` increased recall to 78.65% and reduced merge candidates from 62 to 21, but created 732 extra spaces, lowered precision to 58.67%, and lowered F1 at IoU 0.5 to 67.21% (IoU 0.75 F1 46.05%). Wider portal presets had still worse precision/F1. The development-selected actual native-walls probe produced 424 proposals. It recovers several previously empty lower-west/east regions but introduces many cabinet/fixture fragments and still merges common/unit interiors. It is rejected.

An independent fabricated-ink audit found that pixel support alone did not prove connected swings and missed double swings. A separate corrected version requires raw ink connectivity, hinge/arc endpoints and two covering swing proofs for double doors; its tests reject disconnected sampled dots and unmarked openings. It retains the initial source/report unchanged and can rerank using byte-verified cached context maps. The first native results above apply to the archived first version, not the corrected portal proof.

The corrected proof was reranked on the same 20 development pages using unchanged cached maps. `native_walls` remains identical at 67.21% F1, 282 misses and 732 extras. Short/medium/wide portal F1 values are 65.78%/63.45%/60.05%, with 288/302/319 misses and 787/872/1,014 extras. The connectivity repair removes false closure proofs but does not make this supplement better than the unmodified context model. It remains rejected.

Presets are ranked only on new development pages, with full source/data/reference hashes. Actual A511 remains a qualitative failure probe and is not used as a quantitative tuning target. No native challenger is promoted without unseen real-project evidence. The historical paired geometry report keeps its original config fingerprint even if a later web build changes `tsconfig.json`; reusing it is explicitly recorded rather than misrepresenting old scores as a new geometry execution.

## Longer context training

Before another architecture change, the same 2.456M-parameter model was trained for 48 epochs on the identical frozen 80/20 development dataset and configuration. It used verified archived sources so simultaneous app/diagnostic edits could not alter training. The run took **702.10 seconds**, still with **1,434.33 MiB** peak CUDA allocation. Epoch 47 had the lowest validation loss, **0.4832**; the final epoch was 0.4866. All 100 records/300 assets and the original v2 checkpoint were reverified unchanged.

Fresh paired scoring reproduced the frozen v1 and geometry instance counts exactly. The longer context model improves precision and boundary overlap, while missing slightly more reference spaces:

| Context model | Recall at IoU 0.5 | Precision at IoU 0.5 | F1 at IoU 0.5 | F1 at IoU 0.75 | Misses | Extra spaces | Merges / splits | Zero-miss floors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 epochs | 76.53% | 74.39% | 75.45% | 59.25% | 310 | 348 | 62 / 20 | 0 / 20 |
| 48 epochs | 75.32% | 92.82% | 83.16% | 69.37% | 326 | 77 | 42 / 0 | 0 / 20 |

Neither model recovers every space on any of these 20 development floors at IoU 0.5 or 0.75. The longer model's interior IoU is 95.99%; boundary IoU 72.07%; opening-closure IoU 50.18%, recall 65.83%, precision 67.84%. These pixel gains do not solve complete instance recovery.

The native A511 long-model probe is **rejected**: only 41 proposals (12 with holes), taking 7.17 seconds and 201.42 MiB peak CUDA allocation. It avoids giant sheet/title/parking proposals but misses nearly all west/north spaces and still merges some apartment interiors. The learned interior map covers much of the missing building. Of 4,301,789 pixels with interior score at least 0.5, 3,951,083 (91.85%) lie in raw nonbarrier components touching the page border; the global polygonizer discards those components. This supports a wall-leak/rejection hypothesis, not a measured real-room recall. A clipped building wing must not be mistaken for successful individual rooms.

CUDA `grid_sample` backward can be nondeterministic despite cuDNN flags, so identical seeds/source/data do not promise bit-identical repeated training. The selected candidate's one-time new-site generated-sheet check below excludes every site used in v1/v2 training or validation as well as the 89 original protected sites. It remains simulated-sheet evidence, not real-sheet recall.

## Fixed operating-point and ROI experiment

Six declared hypotheses were compared on the same 1,321 development spaces. No broad threshold search was performed. The `.4` below is a pixel barrier threshold; room matching still uses IoU 0.5/0.75. Bounded support is interior probability ≥0.15 dilated by 0.003 of page width/height, with enclosed support holes filled before clipping. The scaled area is 25 × (maximum page dimension / 1024)² pixels (minimum 25); the core adds nine similarly scaled pixels with interior score ≥0.7. Neither score is calibrated confidence.

| Operating point | F1 at IoU 0.5 | Recall | Precision | Misses | Extras | Merges / splits | Zero-miss / exact floors at IoU 0.5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal flood-fill, barrier .5 | 83.16% | 75.32% | 92.82% | 326 | 77 | 42 / 0 | 0 / 20 |
| Normal flood-fill, barrier .4 | 84.99% | 78.65% | 92.44% | 282 | 85 | 40 / 2 | 1 / 20 |
| Bounded support, barrier .5 | 82.57% | 76.00% | 90.37% | 317 | 107 | 71 / 2 | 0 / 20 |
| Bounded support, barrier .4 | 84.47% | 79.26% | 90.41% | 274 | 111 | 64 / 2 | 1 / 20 |
| Bounded support + scaled area | 83.77% | 75.62% | 93.89% | 322 | 65 | 71 / 2 | 0 / 20 |
| Bounded support + scaled area/core | 83.52% | 75.02% | 94.20% | 330 | 61 | 71 / 2 | 0 / 20 |

Every point has zero fully recovered floors at IoU 0.75. Baseline's 326 unmatched spaces associate with 178 raw page-border component rejections, 62 retained merged proposals, 34 weak-interior component rejections and 52 boundary/fragment mismatches. These are descriptive associations, not definitive causal diagnoses or literal absence in every case; low IoU also counts as an unmatched space.

**Bounded ROI is rejected.** On actual A511, its .4 point fills most of both wings and the north strip with a single giant component, and includes exterior footprint fragments. This is a merged building mask, not individual rooms. Normal .4 gives 59 proposals, still with major west/north misses and apartment merges. Neither actual probe establishes completeness or merits promotion.

The selected simulated-development point is therefore **long48, normal flood-fill, barrier .4**, which improves recall over .5 with a small extra-proposal increase and fewer merges. The exact six-point report, checkpoint, source hashes and settings were frozen before new-site rendering. The once-only adapter explicitly replays `.4`; it rejects untested native/ROI combinations and a silently substituted `.5` baseline.

## One-time new-site result

After selection, 20 pages from **20 distinct new sites** were rendered and frozen before scoring. All 153 sites in the union of the original protected geometric evaluation and every v1/v2 training or development-validation site were excluded. This uses the same procedural whole-sheet renderer and is therefore a check of new generated layouts, not construction-sheet domain accuracy.

The frozen selected point was replayed once: long48, barrier .4, interior .35, minimum component area 25 pixels and overlap 128, with no bounded occupancy clipping or native supplement. The pages contain 1,165 reference spaces:

| Method | Recall at IoU 0.5 | Precision at IoU 0.5 | F1 at IoU 0.5 | F1 at IoU 0.75 | Misses | Extra spaces | Merges / splits | Zero-miss floors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Selected context model | 81.29% | 88.75% | 84.86% | 74.19% | 218 | 120 | 37 / 6 | 0 / 20 |
| Existing geometry, no seeds | 35.97% | 56.17% | 43.85% | 34.64% | 746 | 327 | 47 / 23 | 0 / 20 |

Both methods completed with zero failures. Neither has any floor with zero missing spaces, or zero missing/extra spaces, at IoU 0.5 or 0.75. Selected-model pixel IoU is 94.92% interior, 68.35% boundary and 44.50% opening closure; opening recall/precision is 62.56%/60.65%. Model median inference/postprocessing was 1,118.5 ms versus geometry 6,240.5 ms including Node startup, again not a fair production service-speed ratio.

The once-only attempt is complete. No parameters, architecture or training were changed from these results, and no rescoring was performed. These 20 exposed sites must remain excluded from future training and parameter selection. The path-bound markers enforce this selection's single attempt; cross-experiment site reservation also requires preserving the manifests and exclusion policy. The exact 21 Python scoring sources and checksum index are archived beside the selection. **The model remains rejected for production**, both for incomplete generated floors and the observed actual A511 misses/merges.

## Integrity and supervision

The harness verifies asset hashes/path containment, site/project split isolation, checkpoint architecture/source hashes and data manifests. V2 uses verified immutable in-memory training snapshots and rejects site aliases/identical assets across splits. Predictions retain normalized geometry and holes. Narrow bridges and shell/hole contacts are validated; invalid contours fall back to exact unions of pixel cells, avoiding a silently successful mask score with unusable polygon output.

Actual manual additions enter the guarded context review adapter as positive missed-room examples only when the immutable approval evidence refers to the exact copied drawing hash and matches the current approved shape. Partial reviews supervise approved interiors and their boundaries; they supply boundary negatives inside those approved interiors and leave all other pixels unknown. Rejected merged proposals are never painted as background. Dense real-floor supervision requires current explicit completeness attestation and matching drawing hashes; legacy confirmation or a replaced PDF does not qualify. Opening labels stay unknown on reviewed polygons because outline approval does not identify physical door portals.

`context_review_data.py` provides the same verified positive/unknown supervision to the context architecture, including conservatively masked overview targets. It preserves the synthetic pages/splits and copies source PDF, export and prepared preview provenance. Protected whole-PDF aliases are quarantined before resolving their assets, and identical PDFs cannot cross splits through renamed jobs/pages/previews. Partial reviewed floors are excluded from full-space context evaluation. Duplicate/nested/significantly overlapping dense physical-room instances are quarantined before instance rasterization overwrites labels; one native pixel per boundary is tolerated, with corridor holes preserved. No actual reviewed dataset or fine-tuning run was performed here. Preview preparation is recorded rather than claimed to be native production PDF preprocessing.

One-attempt evaluation is bound to canonical original selection/corpus paths and both selection/corpus markers; copying the corpus/selection or removing only a local marker cannot create another test. The older v1 evaluator also now freezes/reverifies input assets, manifest and checkpoint before/after decoding and scoring. These integrity changes do not reinterpret historical accuracy.

The duplicate legacy `build_data.py --feedback` path was removed after frozen scoring because its job-level exclusions did not enforce the current whole-PDF policy. Programmatic legacy ingestion also fails before any input access. Shared positive-target helpers remain for the guarded context adapter. This support-only cleanup does not alter archived training/scoring sources, weights, datasets or historical metrics.

The final offline harness has **69 passing fabricated tests** covering topology, masked supervision, immutable inputs, site/PDF split exclusions, dense annotation conflicts, source mutation and one-attempt evaluation. Python compilation and whitespace checks pass. These tests establish software contracts, not live model accuracy; the real A511 probe remains unsuccessful.

Required next evidence is complete annotation of several actual projects, including common areas, small rooms and halls without labels. Score full-space recall, false rooms per sheet, corridor/small-space recall, merge/split errors, IoU 0.5/0.75 and the fraction of floors with zero misses. Training on richer synthetic pages is a useful falsifiable development step, not a claim of perfection.

## Private artifact checksums

Artifacts reside under `/home/tim/datasets/foremanhq-room-detection/models/` and are intentionally not committed.

| Artifact | SHA-256 |
| --- | --- |
| V1 data manifest, `data-pilot-v2-20260930/manifest.json` | `ce022ade7db2a97e5c31658c40926eef98b6c2e08e44520a5e6fe60fbdafe30d` |
| V1 checkpoint, `train-pilot-20260930/best.pt` | `8359e6c7c77228cb8ca738f0467aa0b13e1eb305b6e2c9b025b1d7482caecf3d` |
| V1 paired report, `eval-pilot-20260930/report.json` | `221992b7e65dbb00e36aefd822466498a59f9a9e5e050ffd51f13eb679dcfcd4` |
| Clean native A511 RGB input | `0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828` |
| V2 data manifest, `data-context-20260930/manifest.json` | `79c22af5e8b2faeac31c6b8b290d292dccc5d9c34db542474edaa79b951a4cac` |
| V2 checkpoint, `train-context-20260930/best.pt` | `aac6a4edde995b505113a59c31bcd11c80103e66f21be00eca400b4414712314` |
| V2 paired report, `eval-context-20260930/report.json` | `a0766fb1cdcb4dc88946d60920694f85532d734a65da975243bd6b6f6bc624b1` |
| Longer context checkpoint, `train-context-long-20260930/best.pt` | `aaa9990485a71a93406bf84ed21871f20721b0981c069247928c379633dd8313` |
| Longer paired report, `eval-context-long-20260930/report.json` | `ae378a9b0f11c785835dd5b6500e448db8298cdd8ac849ec35d4d36185d48150` |
| Corrected native report, `eval-hybrid-native-v2-20260930/report.json` | `347ec044b153088ca745bbd05d1a3676e106170cc0729f17d9957a22575cf869` |
| Six-point development report, `eval-roi-context-long-20260930/report.json` | `cac68bd373761d21faaa8c7a2a7c7d2ee70ee7a6ef1db4ea64593d478e7a31f3` |
| Frozen selection, `selection-context-long-20260930/selection.json` | `fffff95dcd8becce1e3c3aef9825233e7c59e6f7c51b3c5e5c24b167ee426833` |
| Once-only input manifest, `data-context-generalization-20260930/manifest.json` | `f8cb98efb4c35bfc87d27f4c616f82a7b69cc03fa646d960f043f7d490f0d593` |
| Once-only report, `eval-context-generalization-20260930/report.json` | `d60e29b53d921d38729642e8279eb8760d09bb483f59f0acc47482d53295edc2` |
| Once-only completeness, `eval-context-generalization-20260930/completeness.json` | `a72b4244f89892ec96e3f2e418372451f0744eef273793533c52d46b33ae50a8` |
| Frozen 21-source checksum index, `selection-context-long-20260930/frozen_sources/CHECKSUMS.json` | `e5925ddb9c2b126c2c9a3b6c782c971d964130b16d848a54cd805b03733e4643` |

Full manifests/run reports record seeds, constituent layouts, source hashes, exact input/target hashes, thresholds, losses and runtime information. [MSD JSON's CC BY 4.0 source](https://zenodo.org/records/17294451) and the underlying [MSD benchmark](https://github.com/caspervanengelenburg/msd) require attribution. These experiments use no CubiCasa/LIFULL data or downloaded pretrained weights.
