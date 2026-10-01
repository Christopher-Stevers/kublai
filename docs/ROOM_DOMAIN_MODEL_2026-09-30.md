# Fixed scale-and-sheet model trial — 2026-09-30

The one authorized 48-epoch model substantially improved all three masked pixel heads on the generated domain-development sheets relative to the genuine Swiss v4 true-opening control. The fixed A511 output still has visible exterior leaks, fixture splits and missing or merged spaces. **Root rejected the candidate as the production default.** The results support the fixed scale-and-sheet data hypothesis on simulated pixels but do not establish complete physical-room detection or real-sheet accuracy. Independent metadata/raw-byte result verification cleared all four phases.

## Fixed hypothesis and control identity

The [completed domain-data build](ROOM_DOMAIN_SCALE_DATA_2026-09-30.md) retains the exact original Swiss v4 100 source records, site/alias groups, source-row associations and training 80 / development 20 split. Each source is rendered once at a predeclared isotropic density of .4, .7 or 1.0, on a 2048×1536 RGB sheet with denser fixture, parking, grid, title and revision nuisance. The build uses genuine source wall/window/door footprints; added nuisance changes input pixels only. Unknown source and mixed raster edges remain masked. Native and overview targets contain `target` and `known`, with no provisional room `truth` array.

The comparison is against the completed **genuine Swiss v4 true-opening48 control**, checkpoint `6e2be29b…`, trained on manifest `619fc061…`. Both models use the same physical-head semantics and underlying 80/20 source split. The domain build changes rendering exposure and rational raster support at transformed edges, as described in the data report; it is a fixed bundle rather than an isolated scale ablation. The prior centerline/artificial-gap context model is not a comparator in this trial.

The immutable paired evaluator retains method key `frozen_long48` for the genuine v4 control and `true_opening48` for the new domain model. Its inherited `limitations` sentence saying the old model learned centerlines and arbitrary gaps is historical prose and does **not** describe this control. The new source plan, authorization and every outer phase receipt explicitly record the genuine control's checkpoint, training manifest and completed lineage. The raw inner report is preserved unchanged.

Original procedural-context20 transfer was excluded before execution. No new once-only generalization or protected MSD pixels were opened. Swiss source functional areas and derived components were never used for instance metrics, room recall/F1, floor completeness, GT-derived seeds or crop selection. No settings, thresholds or models were searched after viewing results.

## One training and paired head result

Root authorized the independently audited [fixed wrapper](../scripts/rooms/domain-model/README.md) after the dataset's original completion chain, full native mask QA and two fixed render samples passed. The unchanged archived `models/context_train.py` trained once from random initialization for 48 epochs: tile 512, batch 2, four patches per case, base 16, context base 8, context loss weight .5, learning rate .001, seed 20260930 and four CPU threads. The model has 2,456,454 parameters. Lowest declared development loss selected epoch 48, loss .5774726018309593. Training took 591.38 seconds and peaked at 1,434.33 MiB CUDA allocation on the RTX 5060 Ti.

Paired native inference used the same 20 domain-development IDs, images and target/known byte associations for both models, tile 512 / overlap 128 / overview 512. Interior probability is the unchanged mean of native local and aligned overview heads. Every head used fixed threshold .5 and scored only pixels with its known mask. Both methods completed all 20 cases. These are aggregate pixel metrics, not detected-space metrics.

| Head | Genuine v4 control IoU | Domain48 IoU | Control precision | Domain48 precision | Control recall | Domain48 recall |
|---|---:|---:|---:|---:|---:|---:|
| Interior | .182165 | .942787 | .189458 | .957114 | .825551 | .984371 |
| Physical boundary | .172388 | .859100 | .174675 | .904426 | .929412 | .944880 |
| Genuine opening closure | .029398 | .496721 | .030156 | .601725 | .539026 | .740021 |

| Head | Known pixels | Unknown pixels excluded | Control TP / FP / FN | Domain48 TP / FP / FN |
|---|---:|---:|---|---|
| Interior | 62,393,055 | 521,505 | 4,682,946 / 20,034,629 / 989,563 | 5,583,853 / 250,198 / 88,656 |
| Physical boundary | 62,503,897 | 410,663 | 1,736,356 / 8,204,131 / 131,874 | 1,765,253 / 186,540 / 102,977 |
| Genuine opening closure | 62,503,897 | 410,663 | 77,512 / 2,492,835 / 66,288 | 106,415 / 70,435 / 37,385 |

The control took 26.34 seconds and the domain model 25.69 seconds for the 20 native passes; each peaked at 202.92 MiB CUDA allocation. The large reduction in simulated negative-pixel false positives is the strongest observed change. The generated development distribution uses the same fixed renderer family as training and was used to select the epoch, so these improvements are development evidence. They do not identify which part of the combined scale, rasterization or nuisance correction caused the result, or demonstrate transfer to construction drawings.

## Fixed A511 qualitative probes

The one clean text-free A511 input is 5000×3750, SHA-256 `0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828`. Root ran one native model pass, retaining the cached three-head map. The plain operating point uses boundary .4, interior .35 and minimum area 25. The subsequent CPU pass consumes that exact cache with unchanged `hierarchical_basins`, core SHA-256 `49cfc8ea71eadab40428801beb260e7dd03262422233bdf5ae0dc7278fd3d713`. Markers come only from inferred support; no independent room reference, expected count or GT-derived seed enters either probe.

The native probe took 8.06 seconds, peak CUDA 201.42 MiB, and emitted 518 plain proposals. The cached hierarchy took 9.82 seconds and emitted 394 proposals with 624 retained holes. Its largest proposal occupies 227,383 pixels, 1.2127% of the full page. The inferred support contains 5,101,544 pixels; 463 markers and 48 merged interfaces are diagnostics of this fixed partition procedure. These counts neither certify rooms nor measure misses, extras or completeness. The exact labels and polygon-with-hole exports are retained outside Git.

Root inspected the original `actual/plain-overlay-preview.png` and `actual/hierarchical/overlay-preview.png`. Parking/frame suppression looks improved, but the hierarchy visibly leaks outside the building at the north roof, northwest inner bend, northeast inner vertical edge, southeast inner wing/courtyard and southwest projection. The plain output has fewer large leaks but shows fixture/bathroom splits, ragged boundaries and apparently missing or merged spaces. These are visual failure observations without independent complete real-space ground truth; neither their frequency nor an actual recall or precision was measured. The candidate was rejected as the production default.

The inspected plain preview is SHA-256 `6a6ec3b8d0625b4de928e96e3f08680064b1f5d4abe6da274d3daccd048a7ace`; the hierarchical preview is `7095ffd139942ebd1b8db615ba956559f1176c97e3b062cbc2e87822627bfe35`. No new inference, settings change, crop or repeat followed this inspection.

## Original execution evidence and verification

All private outputs use prefix `/home/tim/datasets/foremanhq-room-detection/domain-model/swiss-domain-fixed48-20260930`, with separate `.training`, `.heads`, `.actual` directories and `.actual/hierarchical`. Experiment-scoped original phase claims are siblings outside those output directories; changing or deleting outputs cannot reset the attempt. No retries or alternate-output runs occurred.

Before native decode, the wrapper binds the complete executable adapter, immutable Swiss wrappers, architecture/trainer/inference sources, builder completion helper and partition core. Thirty-seven Python source identities and private copies are retained. The source plan additionally pins its four own files and the genuine control's checkpoint plus four original metadata records. Root authorization pins the exact completed child manifest, completion, original binding, build claim and global receipt. Unique imports restore temporary same-name `contract`/`render` module aliases even on failure. Every outer completed phase binds its fixed plan, authorization, data, runtime, original claim, sources and emitted bytes, with false production/all-space eligibility flags.

Twelve fabricated CPU tests passed and were independently rerun before authorization. They cover source/auth/import/replay guards, genuine-control lineage substitution, acceptance of all four valid inner writer-shaped completion records, late receipt/output mutation and spent-failure rejection. Each completed phase captures output hashes immediately and repeats original control, source, runtime, data and emission checks after writing its receipt. The four final outer inventories contain 50 training, 85 paired-head, 48 actual and 10 hierarchy entries; these are inventory associations, with shared bytes also bound by later phases.

| Evidence | SHA-256 |
|---|---|
| Final v4 source plan | `21fa596c97834d5b6277ef94190fab8879d9949090919f498fecbce891c1f04e` |
| Root authorization | `3cbea415a66015306583d9374401348a299fd4131f5c52a385c1d8843d4806a3` |
| Domain data manifest | `78d1ce1e2f9eb9ff9c913e332e767c9fe459cd663ea03c9e3b202398bdd1df82` |
| Domain data original global receipt | `42195f4c515ab641efaee68f3c3bb9f43e1537a7528c6e656be15749924a3035` |
| Genuine v4 control checkpoint | `6e2be29bac8fadce06b103e93e08e4bc32d3e79a7b9258217edc5cb87dcb3aa4` |
| Domain48 checkpoint | `434217b1d35c0a400d32db6711612f19ea56c45fd0937f3afaa331b3c1db6a66` |
| Training binding | `7f199513b1ac63493a91ff9e296f0b5351db0e4264a56659b4c5ca52a79e5d63` |
| Training `run.json` | `b945347da584f619ca9d50d40aeb3c39065831d3657a87d230df395205bf3ed8` |
| Paired-head `report.json` | `61eeeff452ec49aed84577a6647ac99743d25372f7c2fceb8f97e3e8a749ba51` |
| Actual `probe_binding.json` | `37af31e658004410229a50941dd67c5d2771a80e2bda8c749fc3bf7991617063` |
| Cached A511 `probabilities.npz` | `a83ff4910d16d884b4429ec08e5249aa18e823268014b9464581fbdd1e800c5c` |
| Plain polygon export `plain.json` | `9fa903c8b3ccf26e3d08c49ee4f03d57554e0b93959a4a66426430ec39c3b39d` |
| Plain exact labels `plain-labels.i32` | `887bf8ef01193fc794d1ebc2ca2ed83356a2eece817962fae4575346eadefb8e` |
| Hierarchy `prediction.json` | `df939e12992f1d88c767ecef5e531e73d5c0b8b8e935d05edb3cbb3cec627799` |
| Hierarchy exact labels `labels.i32` | `61d7dfd17f75aa57bfa4aeec24c8ee13695ec72a10feeadbad3d362488081242` |

| Phase | Original outer claim SHA-256 | Original outer completion SHA-256 |
|---|---|---|
| Training | `d1623d43ca0379e677574417b7c8d6a2cebe812aded0667bdcd5c7718413de49` | `907130b421556a4682717ef7113fc1f8b5dde13364ef08ff38dd5ea0aab78c09` |
| Paired heads | `59ebf38d4e43f4b5eead2370f2eaac08d50c9aba3ba34ac390b4bda79d1484cc` | `347670bbfc9fcf5dfc05cc57c5cd8fec94f0c618c23cd94a02cb88a825b812d0` |
| Actual plain | `33b1a42841a5e6ba80f9158920026af4df6a4f0f86e198aa963e26c8139fa1d4` | `d16e41678bdf201687b1690bbf2827d7bf7c6a5a0d5943ccf908d73d999f47a8` |
| Cached hierarchy | `6a7f9b679f7259d473850574836e0ac1e3172824fd2dfe856b5236a4340b71a8` | `e260a58d3deb7d0d38c1a38c5a2d8c66a785e312a3ee638ce6664b51bd3e9982` |

The GPU phases used Python 3.12.14, Torch 2.12.0+cu130, CUDA 13.0, NumPy 2.5.3, Pillow 12.3.0, OpenCV 5.0.0.93, SciPy 1.18.1 and Shapely 2.1.2. The hierarchy CPU runtime uses the same Python/NumPy/Pillow/SciPy/Shapely versions and scikit-image .26.0. Final independent metadata/raw-byte verification cleared all original/inner claims and receipts, 37 source/current/archive identities, runtime package metadata, genuine v4 control lineage, all head case/style/aggregate arithmetic, 40 caches and eight CPU output hashes. It verified 1,559 unique raw-file pins without importing Torch, decoding models, arrays, pixels, GT or geometry, or using the GPU. Audit report: `/home/tim/datasets/foremanhq-room-detection/domain-model-audit/all-phases-20260930.json`, SHA-256 `6e2caedfcfea225680615fc2ff87e6c945edb8835fb4275321747f2e0b336992`.

The pages are simulated raster drawings of genuine source geometry. Original Swiss construction-sheet images remain unavailable; annotation, fixture and drawing styles are simulated. Physical target support may differ from functional source-area boundaries, and resampling can change fine topology. None of these assets supplies independently reviewed complete real-floor labels. Model approval remains false; current-hash human review on complete real floors is still needed to assess every room, unlabeled hall, common area and small space.
