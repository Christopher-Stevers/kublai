# Fixed scale-and-sheet data correction — 2026-09-30

The one authorized CPU corpus build completed, and all 100 generated native/coarse head assets passed after-build byte and mask QA. Two fixed unprotected render samples also passed visual checks for source clipping and annotation placement. **This is data-quality evidence, not a successful room detector.** No training, new model inference, actual-sheet scoring or production promotion occurred in this data task.

The [read-only scale diagnostic](ROOM_SCALE_DOMAIN_DIAGNOSTIC_2026-09-30.md) measured a visual-distribution gap: Swiss target walls/openings were larger and sheets cleaner and achromatic relative to the procedural development sheets. Inspection of dense A511 also showed clutter-related failures, without quantitative real-sheet ground truth. The separately frozen [builder plan](../scripts/rooms/domain-data/README.md) changes those input exposures without changing original source identities or inventing door geometry.

## Exact corpus and execution

Only the same independently pinned Swiss v4 100 source records were used. They retain original site/alias component, group, source-row and train 80 / development 20 identities. No protected or completed once-only generalization pixels and no original context-development pixels were used as augmentation material. Each output contains one uniformly scaled source floor on a 2048×1536 page; there are no extra duplicated-floor independent samples.

The fixed density schedule is:

| Split | .4 density | .7 density | 1.0 density | Total |
|---|---:|---:|---:|---:|
| Training | 27 | 27 | 26 | 80 |
| Development | 7 | 7 | 6 | 20 |

The source structure crop preserves every original positive physical/interior pixel and every unknown source pixel, with an 8px bounded halo, while removing the old sheet title/frame. Transform coefficients are isotropic; placement never silently fits or clips a structure. Source gray/paired ink styles remain, and independently added grid/title/parking/fixture/revision ink leaves physical masks unchanged.

The target contract differs from baseline v4 at raster edges. Exact rational pixel-cell overlap preserves any transformed wall/window/door and genuine opening support; opening remains a boundary subset. It can expand the edge by at most one destination pixel cell and can connect nearby source entities. Majority interior excludes physical footprints, and mixed interior pixels are unsupervised. Any source unknown contributor propagates to that output head. Conservative regenerated 512×512 coarse masks similarly preserve thin opening support and unknown pixels. Original door-swing ink extending beyond the crop halo can be clipped; the genuine door footprint is retained. No claim of preserved door-entity counts or physical-room topology is made.

Root executed the one CPU build after independent original binding clearance. It finished in 50.92 seconds and returned exit0. The predecode freeze preserved 401 original file byte pins plus 401 private copies, and five source/archive identities. Independent audit verified the exact 100 IDs, 80/20 associations and density schedule before writing the original-path `AUDIT_CLEAR.json`. The experiment claim is consumed once; a changed output path cannot cause another build.

Private corpus directory: `/home/tim/datasets/foremanhq-room-detection/domain-data/swiss-domain-scale-v1-20260930`.

| Original evidence | SHA-256 |
|---|---|
| Source Swiss v4 manifest | `619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b` |
| Frozen build `binding.json` | `755d0c6ad8b01e978822602ab2bb58b842302015f0afb93188eb11e42cc4273c` |
| Independent `AUDIT_CLEAR.json` | `219ab195b64811b35736c9f3071cc73f39154687d73b95cddfbc04ac92432ee2` |
| Global build claim | `6bceeb1ead9356af58c9dc458ed3c781bf334452f905192015ac08733d500637` |
| New `manifest.json` | `78d1ce1e2f9eb9ff9c913e332e767c9fe459cd663ea03c9e3b202398bdd1df82` |
| Emitted `completed.json` | `7fa4b0247f3fe3ed9e59317ac1934441028cbea3f5288530ea1934643b81d589` |
| Original global completion receipt | `42195f4c515ab641efaee68f3c3bb9f43e1537a7528c6e656be15749924a3035` |

The global completion receipt is the sibling `swiss-domain-scale-v1-20260930.completed.json`. It binds the originally emitted completion, manifest and exact501 generated-asset/receipt digests. The executable `completed_build()` gate checks the original path, claim, audit, source/archive/runtime identities and complete per-source association, then repeats byte checks after metadata decoding. Copying or rewriting an output cannot establish a new completed corpus. Later model code must call this gate and verify arrays itself before training.

## After-build QA

The new [QA adapter](../scripts/rooms/domain-qa/README.md) checked all 100 authorized RGB images, native three-head target/known arrays and coarse arrays. NPZ members are exactly `target` and `known`; baseline provisional `truth` is neither read nor emitted. Native dimensions are 2048×1536 and coarse dimensions 512×512. All masks are binary `uint8`; no opening lies outside boundary support, and no supervised interior overlaps a physical barrier. Native byte hashes were verified before/after decoding, and the original completion chain was checked again after the full pass.

The pass took 29.24 seconds, peak host RSS 1,202.25 MiB, in the existing CPU Python 3.12.14 / NumPy 2.5.3 / Pillow 12.3.0 / SciPy 1.18.1 environment. It used no GPU, source WKT or reference matching. Three fabricated QA tests passed in addition to 21 builder tests. Independent source audit also checked 189 thin-point wall/door/unknown placements against integer interval intersections, separately from the builder's sparse transform helper.

| Head | Native positives | Native known | Native unknown | Coarse positives | Coarse known | Coarse unknown |
|---|---:|---:|---:|---:|---:|---:|
| Interior | 31,456,443 | 313,038,415 | 1,534,385 | 2,627,691 | 25,843,388 | 371,012 |
| Boundary | 7,957,275 | 313,638,410 | 934,390 | 834,316 | 26,133,375 | 81,025 |
| Opening | 692,814 | 313,638,410 | 934,390 | 84,170 | 26,133,375 | 81,025 |

There are six original source-semantic partial cases. Additional mixed raster edges create unknown interior pixels in otherwise defined cases. **3,967 native and 1,362 coarse positive opening pixels are unknown** and must be excluded by loss/scoring masks; retaining their positive target value does not make them supervised. These totals count pixels, not doors, detected rooms or true positives.

Measured nuisance statistics across 100 pages:

| Quantity per page | Minimum | Median | Maximum |
|---|---:|---:|---:|
| Newly added fixture loops/treads | 72 | 160 | 160 |
| Parking/landscape motifs | 29 | 32 | 32 |
| Existing known-negative pocket motifs inside crop box | 0 | 8 | 8 |
| Chromatic pixels | 4,626 | 5,754.5 | 7,148 |
| Known-all-head-negative ink pixels per Mp | 12,410.8 | 16,215.2 | 18,306.4 |

All pages contain RGB revision/landscape ink, versus zero chromatic pixels in all 100 baseline v4 renders. Native known-negative ink density median is 3.09× the 5243.6/Mp measured baseline all 100 value, using the same luminance 245 definition. This confirms the intended greater negative-ink exposure, not improved model accuracy. Inside-box motifs remain within supplied all-head-known-negative support with more than 12px clearance from positive or unknown pixels; no courtyard/parking semantic label was inferred. Every added fixture box stays wholly within known interior support, and all caps and recorded pixel totals match the emitted arrays. Eight revision clouds occur per page. The median target interior fraction is .0762, with p10/p90 .0262/.2040; this describes generated support and density only.

Private QA report: `/home/tim/datasets/foremanhq-room-detection/domain-data-qa/data-swiss-domain-v1-20260930/report.json`, SHA-256 `c6944e872c78ea21cbd337a781bb6fd8eee03b13a15035f603a48d3b60525875`. The executed QA source is preserved alongside it, SHA-256 `61e93f3ff1339b7f07fad7cca429127b83fb20505f00c2f3dcc9d19342bbcadd`.

## Two fixed visual samples and limits

The QA adapter chose the first sorted .4-density paired-style page and first sorted 1.0-density paired-gray-2 page from metadata before opening any pixels. Both PNGs were inspected at their native resolution:

| Unprotected source ID | Condition | Image SHA-256 |
|---|---|---|
| `swiss-floor-40311652a0b87b08018c` | .4 / paired-white-1 | `7186457d2991d96078053856f2deab052a803206a92392f1ef4454ff843cb4ac` |
| `swiss-floor-c6aaa6787aa40f3bd216` | 1.0 / paired-gray-2 | `5efbb89b1275018eed9ba694e315e88d8ed47f8cfa50715e39c6ace97875f2a1` |

The small paired example retains a contained floor crop with dense fixture loops and nearby/crossing revision clouds, surrounded by sheet grids and nonroom enclosure ink. The full-density paired-gray example visibly retains weak gray structural outlines beneath darker simulated fixtures and revision strokes. The original title/frame is absent from the pasted crop; the fresh title block occupies the declared right column. Neither sample showed a structure-cropping or canvas-placement blocker. This inspection did not label physical rooms, measure misses or decide whether a model detects them correctly.

The pages are simulated drawings of genuine source geometry, not original construction sheets. Fixtures and nuisance patterns are deliberately heavy and artificial; their repetitions may create shortcuts. Each page still contains an isolated original floor rather than a validated dense A511-scale multi-wing building. Source semantic text remains in cropped render input, while A511's fixed model input is text-free. These domain differences remain. Functional references are unchanged in source meters; their baseline derived raster memberships are invalid on transformed pixels and cannot be converted into certified room truth. All-space scoring, physical-room certification, human completeness evidence and production approval remain false.

A separately authorized and source-frozen model trial can test whether the corrected data distribution helps masked heads and a fixed qualitative A511 probe. This completed data build does not authorize that trial or supply independent real-room ground truth. Current-hash, independently corrected complete real floors remain necessary to measure the business requirement of every room, unlabeled hall and common space.
