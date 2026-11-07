# Drawing scale and domain diagnostic — 2026-09-30

The evidence favors correcting the **training drawing distribution before changing the network or partition thresholds**. The genuine Swiss renderer teaches much thicker physical footprints, larger openings and cleaner, entirely achromatic sheets than the original procedural development pages. It also omits the colored revision clouds and courtyard/parking clutter that caused false regions on A511. This explains plausible failure mechanisms; it does not establish causality or actual room accuracy.

This work is read-only. It trained no model, ran no inference, changed no detector setting and touched no frozen model, partition, Swiss source or production code. Only the original context-development 20 pages and the Swiss v4 train 80/development 20 assets were decoded. Protected geometric sites and the completed once-only generalization sites were not reopened.

## Reproducible descriptive measurement

New CPU-only source and four fabricated tests are in [scripts/rooms/diagnostics](../scripts/rooms/diagnostics/README.md). The run took 62.21 seconds in the existing Python 3.12.14 CPU environment: NumPy 2.5.3, Pillow 12.3.0, SciPy 1.18.1, scikit-image 0.26.0 and Shapely 2.1.2. Selection happens before asset access; bytes are checked before/after decoding and at completion. No weights or probability arrays are decoded for these distributions.

| Frozen input | SHA-256 |
|---|---|
| Original context manifest | `79c22af5e8b2faeac31c6b8b290d292dccc5d9c34db542474edaa79b951a4cac` |
| Original 20-case partition binding | `c6de300983e801a7e64e9d9f307009444248ad03b06198682607b360592f680f` |
| Swiss v4 manifest | `619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b` |
| Executed diagnostic source | `62adab0f87a28509296746135c1c53bd6c594344ea4161e200694c0ac547c5c7` |
| Descriptive report | `dacca3a4d6fc154bf04d5af34a43892344035e2ff51ee0aad76a3a93be85058e` |

Private report: `/home/tim/datasets/foremanhq-room-detection/diagnostics/scale-domain-20260930/report.json`. The exact source snapshot and `completed.json` are alongside it. Per-case distributions, geometry scales and all source-asset hashes are retained there.

The table entries below are **p10 / median / p90**. Pooled feature distributions weight samples equally, not floors equally; page distributions weight pages equally.

| Native or projected scale | Context development 20 | Swiss train 80 | Swiss development 20 |
|---|---:|---:|---:|
| Barrier diameter proxy, native px | 2 / 4 / 8 | 4 / 10 / 24 | 4 / 11.66 / 34.06 |
| Barrier diameter, minimum-axis overview projection px | .47 / .71 / 1.12 | 1 / 2.50 / 6 | 1 / 2.92 / 8.51 |
| Opening component major span, native px | 3.19 / 15.30 / 27.67 | 20.36 / 37.12 / 66.69 | 25.71 / 44.80 / 79.89 |
| Opening component minor span, native px | 1 / 5.00 / 9.40 | 4.62 / 7.92 / 15.67 | 4.69 / 9.41 / 20.03 |
| Opening component area, native px² | 5 / 51 / 150.6 | 73 / 240 / 824.7 | 87.4 / 376.5 / 1139.8 |
| Opening major span, minimum-axis overview projection px | .55 / 2.74 / 4.35 | 5.09 / 9.28 / 16.67 | 6.43 / 11.20 / 19.97 |
| Region area proxy, native px² | 986 / 7,491 / 43,049 | 2,084 / 12,977 / 59,811 | 4,222 / 17,129 / 71,505 |
| Region bbox short side, native px | 38 / 92 / 179 | 53 / 134 / 295 | 76.6 / 165.5 / 353.1 |
| Source indoor functional-area bbox short side, native px | Not available in this diagnostic | 59.06 / 133.93 / 286.61 | 74.52 / 155.56 / 334.70 |

The native Swiss training medians are 2.5× wider for barriers and 2.43× longer for openings; their overview projections are 3.54× and 3.39× larger. Tiny opening components under nine pixels number 115/915 in context, 22/2,224 in Swiss training and 0/418 in Swiss development. None were removed from measurement. This indicates a considerable scale and target-contract shift. Region scales overlap: a wholesale difference in room size alone is an inadequate explanation.

| Whole-sheet distribution, p10 / median / p90 | Context development 20 | Swiss train 80 | Swiss development 20 |
|---|---:|---:|---:|
| Page megapixels | 2.91 / 7.05 / 12.95 | 3.15 / 3.15 / 3.15 | 3.15 / 3.15 / 3.15 |
| Region proxy count per page | 33.4 / 51.5 / 125.3 | 8 / 19.5 / 42.2 | 6.9 / 15 / 32.6 |
| Region proxies per Mp | 3.07 / 9.66 / 25.44 | 2.54 / 6.20 / 13.42 | 2.19 / 4.77 / 10.36 |
| Target interior fraction of page | .067 / .128 / .211 | .102 / .185 / .289 | .116 / .182 / .221 |
| Visible ink in known all-head-negative pixels, per Mp | 11,304 / 14,338 / 23,075 | 4,518 / 5,244 / 5,995 | 4,524 / 5,216 / 6,422 |
| Visible ink within target interior, per Mp | 10,738 / 14,437 / 24,124 | 2,041 / 3,784 / 5,859 | 2,051 / 3,328 / 5,319 |
| Pages with chromatic pixels | 20/20 | 0/80 | 0/20 |

Region counts above use procedural reference instances for context and derived interior components for Swiss; they describe render complexity and are not comparable physical-room censuses. The context negative-ink median is 2.73× the Swiss training value. Its ink-within-interior median is 3.81× higher, but this second proxy also includes antialiasing and structural ink extending beyond the procedural centerline target. It must not be described as a measured count of furniture or other nonstructural symbols.

Swiss pages are all 2048×1536. Context page widths vary from 1536 to 4096; multiple layouts occupy separated wings and surround empty space. The measured median ratio of interior area to its enclosing bounding box is .261 for context, .457 for Swiss training and .414 for Swiss development. This is a descriptive sparsity proxy, not a building-outline annotation or courtyard classification.

## What the proxies mean

Barrier diameter is twice the Euclidean distance transform sampled on the Zhang skeleton of the known boundary target excluding openings. The Swiss target includes walls, columns and windows; junctions and raster quantization influence the samples. **These are not separately measured physical wall widths.** [SciPy's EDT documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.ndimage.distance_transform_edt.html) and [scikit-image's skeletonization documentation](https://scikit-image.org/docs/0.26.x/api/skimage.morphology.html#skimage.morphology.skeletonize) describe the underlying operations.

Opening spans are PCA-oriented pixel-cell bounding spans of four-connected known opening masks. A mask component can merge or fragment source door entities. Region scales use the 1,321 original procedural reference instances for context and connected target-interior components for Swiss. The latter are explicitly **not physical-room ground truth**. Swiss source functional-area geometry supplies an additional area/bbox proxy with holes preserved; functional areas need not correspond one-to-one to physical rooms. Swiss `truth` arrays are never decoded. No room recall, F1 or floor success is calculated here.

Overview projections use `512/max(width,height)`, the minimum of the two axis scales. The existing model actually resizes a page anisotropically to 512×512; the report records both axis scales. These projections do not reconstruct the separately dilated/coarsened supervision masks. On A511, the 5000×3750 source-to-overview scales are .1024 and .1365, versus .25 and .3333 for Swiss: 2.44× more compression on either axis. The same 512-pixel native tile also covers a smaller fraction of A511. This is a measured image-size mismatch, not a measurement of A511 room or wall sizes.

Ink means luminance below 245, and chromatic pixels have RGB channel range above 20. These diagnostic definitions did not change any detector operating point. The report's historical field `nonstructural_inside_ink_pixels_per_megapixel` must be interpreted as **ink within target interior**, with the caveat above.

## Why good Swiss head scores do not transfer automatically

The old targets draw functional room outlines at width four and introduce arbitrary simulated gaps before anisotropic montage scaling. The new targets preserve real wall/window/door footprints. Consequently the [paired Swiss head result](ROOM_TRUE_OPENING_MODEL_2026-09-30.md) establishes adaptation to the footprint contract, not a fair ranking of real-room accuracy. Comparing these heads to procedural centerlines can penalize a correctly broad physical wall prediction. Conversely, high interior pixel overlap can still miss a thin separation or doorway and merge multiple spaces.

Source inspection establishes a separate visual-domain gap. The original context renderer supplies U-shaped/separate-wing layouts, empty courtyard areas, parking/landscape enclosures, dashed grids and gray or red revision clouds. Swiss v4 supplies gray solid/paired walls, limited interior furniture and stairs, and a title frame, but no colored pixels across any of its 100 images. An RGB network cannot learn to distinguish chromatic revision ink from monochrome structural ink from those examples alone. Color is a useful potential cue, not a rule that all colored geometry is nonstructural.

The already emitted A511 interior and boundary previews provide qualitative falsification consistent with that gap. The new model puts high interior support in exterior strips and the central parking/courtyard area; boundary support follows parking dividers, title/frame boxes and some nonstructural loops. Stronger genuine-door supervision therefore does not fix building/background discrimination. The fixed partition then operates on these erroneous maps. Combining model heads cannot guarantee that their target contracts, scale responses and interior/boundary supports agree.

The completed [fixed structural ensemble](ROOM_STRUCTURAL_ENSEMBLE_2026-09-30.md) provides a separate transfer check. Keeping old interior and replacing only boundary/opening heads increased misses from 175 to 608, extras from 134 to 1,130 and split candidates from 48 to 348 on the original 1,321 procedural references. Zero-miss floors fell from 3/20 to 0/20 at IoU .5. Its frozen scoring report SHA-256 is `c223dab263321501fc3cc60655c7342f065dbe547f04ca667781acf29fd5d628`. These existing metadata establish a failed fixed combination on exposed generated development data, not a real-room accuracy estimate or proof that scale/color alone caused failure. This diagnostic did not reopen references or rescore the ensemble.

A511 has no independently complete room reference. This inspection uses existing source/probability PNGs only. It does not assign new wall labels, count missed rooms, measure actual recall or claim every false-looking loop is a nonroom. The fixed actual source hash is `0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828`; the existing new-model probability map hash is `a3275485370d377e932a6064a46bf600eeb9a7e53c18439910b6e91871a993d4`.

## Recommended next bounded experiment — proposed, not executed

Use one **versioned scale-and-sheet rendering trial**, retaining the existing compact architecture, losses, optimizer, 48 epochs and minimum-development-loss checkpoint rule. Retain 100 page records and the same 80/20 source-site split; assign one rendering condition per page by a frozen, balanced deterministic schedule. Additional views must not multiply the training budget or cross source splits. Correct the demonstrated data gaps together before interpreting a new architecture as necessary:

1. Preserve genuine source wall/door/window geometry, source-site/alias splits and unknown masks. Transform all coordinates uniformly with the image. Render at three predeclared pixel-density levels: .4, .7 and 1.0 times v4 density. The .4 level projects the Swiss training median barrier/opening scales approximately to 4/14.85 native pixels, near the procedural 4/15.30 proxies; this is an intended coverage check, not a tuned prediction threshold. Freeze data before training and report achieved distributions rather than assuming multiplication is exact after rasterization.
2. Place transformed whole layouts on declared 2048-, 3072- and 4096-pixel-wide sheets, using separated wings and open negative space. Any multi-layout montage stays within a single source-site split and is identified as simulated, not a genuine complete building. Keep original gray/paired structural styles. Do not create fake door gaps or join unrelated halls as genuine opening supervision.
3. Add predeclared RGB revision clouds, dashed dimensions, parking dividers, closed landscape loops and denser fixtures outside/inside supported regions, with safe physical targets unchanged. Sample plausible placement contexts instead of arbitrary clutter everywhere. No color-removal heuristic is introduced. Unknown source areas remain unknown; cutting a layout cannot create certified exterior/background labels. Reject changed-target/cropped-hall/door-transform inconsistencies in CPU preflight.
4. Train exactly one random-initialized challenger, with no setting search. Retain the frozen v4 checkpoint as baseline and pair known-only pixel-head evaluation on the same versioned development inputs, stratified by scale, wall style and clutter. Fix the downstream hierarchical preset before the run. The original context 20 remains a declared procedural transfer probe with its different head contract; it must not be advertised as real-room ground truth. Make one fixed A511 qualitative check. No protected or once-only sites participate.

This tests a combined data-domain correction, so a gain would not isolate which augmentation caused it. That is acceptable for the next practical challenger; an ablation would require a separately authorized experiment. Multiscale training and context-aware synthetic variation have primary support in [DeepLab's official scale-augmentation implementation](https://github.com/tensorflow/models/blob/master/research/deeplab/train.py), [DeepLabv3+'s context/boundary work](https://arxiv.org/abs/1802.02611) and [Structured Domain Randomization](https://arxiv.org/abs/1810.10093). Those studies concern other datasets/tasks and provide rationale, not a floor-plan success guarantee. No external model weights or pipeline code need to be imported for this proposal.

The completed v4 trial took 9.87 minutes and 1.40 GiB peak allocated GPU memory. Keeping 512-pixel tile/overview and four patches/page should keep GPU tensor memory near that order, but larger in-memory pages increase host RAM/cache demand and four patches may undersample a busier sheet. Budget roughly 10–20 GPU minutes plus CPU rendering/scoring for a single trial; this is an estimate, not a reserved resource or promised result. A larger model or new pretrained download is not required to test the present hypothesis.

Promotion still needs independently corrected, current-hash real drawings from separate sites. Approve accurate physical spaces, reject bad proposals, add missing spaces, correct polygons and attest complete coverage. Partial positives leave the rest unknown; a rejected proposal alone never becomes background. Only those complete real-floor references can measure the business requirement of zero missing rooms, halls or common spaces. Synthetic head gains and generated-region counts cannot substitute for that evidence.
