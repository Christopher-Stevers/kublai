# Learned marker partition challenger

The long48 model's actual A511 interior maps cover much of the missing building, yet the binary barrier graph discards large border-connected regions. Occupancy clipping recovered a merged building mask. This development-only experiment asks whether automatically inferred structural markers and a weighted watershed can recover individual rooms without ground-truth seeds or counts.

Primary methods: [scikit-image watershed](https://scikit-image.org/docs/0.26.x/api/skimage.segmentation.html#skimage.segmentation.watershed) uses explicit markers, masked flooding and a priority queue; its zero compactness avoids imposing regular shape. [h-maxima](https://scikit-image.org/docs/0.26.x/api/skimage.morphology.html#skimage.morphology.h_maxima) selects peaks by prominence, with [SciPy Euclidean distance](https://docs.scipy.org/doc/scipy/reference/generated/scipy.ndimage.distance_transform_edt.html) supplying clearance. A room is not equivalent to a watershed basin, so overpartitioning and merged halls remain explicit failure modes. scikit-image's [license](https://github.com/scikit-image/scikit-image/blob/v0.26.0/LICENSE.txt) permits this local experiment; no pretrained model or drawing download is involved.

Before scoring, exactly three settings were declared: 2-pixel marker prominence without merging, 2-pixel prominence with weak-interface hierarchical merging, and 4-pixel prominence with the same merging. Values scale with maximum page dimension /1024. Every variant has the same frozen support, elevation, wall thresholds and area gates; [the harness README](../scripts/rooms/partition/README.md) specifies them. Markers see only model maps. Reference targets are decoded only after all three predictions for that page are complete.

Only the **original 20 context development pages** and existing long48 cached maps are permitted. No exposed once-only new site or protected geometric input is read. Every input/cache/checkpoint/source is bound by SHA-256; current sources are archived before scoring. Every retained mask exports exact valid native pixel-cell geometry with corridor holes, and software failures count as failures. The baseline is the historical normal .4 development report, explicitly reused rather than claimed as a fresh execution.

No production edits or model promotion are part of this experiment. Quantitative actual A511 recall cannot be measured without complete physical-room annotation.

## Original development results

The source-frozen replay scored all three declared settings on the original 20 development pages / 1,321 reference spaces, without a new model inference pass. The historical .4 baseline is reused verbatim. No settings were changed afterward.

| Method | Recall / precision at IoU .5 | F1 at IoU .5 / .75 | Misses / extras | Merges / splits | Zero-miss / exact floors at IoU .5 |
| --- | --- | --- | ---: | ---: | --- |
| Historical normal .4 | 78.65% / 92.44% | 84.99% / 71.33% | 282 / 85 | 40 / 2 | 1 / 1 of 20 |
| Weighted basins | 83.80% / 71.88% | 77.39% / 63.82% | 214 / 433 | 22 / 160 | 3 / 0 of 20 |
| Hierarchical basins | **86.75% / 89.53%** | **88.12% / 78.05%** | **175 / 134** | **27 / 48** | **3 / 0 of 20** |
| Sparse hierarchical | 77.90% / 93.55% | 85.01% / 79.31% | 292 / 71 | 55 / 21 | 2 / 0 of 20 |

All variants have zero software failures. All methods still have zero fully recovered floors at IoU .75. The declared ranking selected hierarchical basins: it improves misses by 107 over normal .4, but adds 49 extra spaces and 46 split candidates. No variant produces an exact floor at IoU .5. Hierarchical median per-setting interval is 2,264.9 ms, including mask/polygon artifact writes but excluding probability-input decoding, model inference and room matching. The historical .4 report's 751.6 ms uses different timing stages, so these are not directly comparable whole-service timings.

## Actual A511 falsification

The selected hierarchical variant used the clean 5000×3750 RGB source's existing long48 maps, independently recorded during the preceding ROI cycle. It emits **270 proposals, 211 with holes**. Its largest component is 188,166 pixels, **1.00% of the page**, eliminating the previous giant-wing merge. Visible coverage of both wings and the north strip is substantially better than the earlier 41/59-proposal binary runs; east hall 116 and many lower-west regions are retained.

It is still **rejected for production**. Exterior/parking shapes 206 and 245 become rooms; perimeter/landscape regions 263, 269 and 270 also show false occupancy. West circulation is fragmented into several basins; fixtures become holes and some apparent room interiors receive unsupported divisions. More proposals and coverage do not certify recall or boundaries. No actual room count, reference crop or human seed entered the algorithm, and this probe supplied no parameter changes. The private overlay is `a511-20260930/overlay-preview.png` under the artifact root below.

The result supports further development of soft evidence and explicit partition topology, while showing that model domain errors and false structure remain. Next evidence should include reviewed construction sheets with complete room definitions and genuine door/wall supervision; procedural improvements alone cannot establish business-required completeness. The previously exposed once-only sites remain untouched by this experiment.

## Integrity, tests and private provenance

After the scoring snapshot completed, only reader/probe support checks were strengthened. They recheck the exact original manifest/checkpoint/report identities, all unique 20 IDs, each method's full coverage, runtime/source consistency and aggregate counts. Actual maps must match independently recorded pre-partition prediction/probability digests, not a fresh arbitrary map hash. Historical source archives remain unchanged, and the current partitioner/metrics must match the original scoring snapshot. Support hashes are captured before probing and rechecked before output; this support-only repair does not change historical predictions or scores.

Fifteen fabricated tests verify inferred markers without GT input, source/cache mutations, dataset/binding identity, per-method coverage, exact polygon area, holes and one-pixel corridors. No protected/new-site corpus or actual drawing is used by these tests. The separate CPU environment uses Python 3.12, NumPy 2.5.3, SciPy 1.18.1, Shapely 2.1.2 and scikit-image 0.26.0. No GPU/model download, retraining, provider call or customer upload occurred.

Artifacts remain outside Git under `/home/tim/datasets/foremanhq-room-detection/partition/`:

| Artifact | SHA-256 |
| --- | --- |
| Frozen binding, `binding-20260930/binding.json` | `c6de300983e801a7e64e9d9f307009444248ad03b06198682607b360592f680f` |
| Development report, `eval-20260930/report.json` | `707cbd22107cedea09bfc018da2f64b0cb30f9b485125271f95d3aa4a56a9e03` |
| Actual prediction, `a511-20260930/prediction.json` | `626d864a4bf8912648af0d6a1f258441429f22dd32c1f76595e002f265df2fee` |
| Unchanged partition source, `partition.py` | `49cfc8ea71eadab40428801beb260e7dd03262422233bdf5ae0dc7278fd3d713` |
| Independently recorded actual map | `0d486d09885b269a5e4571c7be280a393a0dfa5e50ed5acf19a939521ea2610a` |
| Independently recorded actual input | `0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828` |

`binding-20260930/frozen_sources/` retains the exact original scoring sources/checksum index. `a511-20260930/frozen_support_sources/` retains the initial repaired support adapters exactly matching the actual prediction's recorded hashes. The subsequent support-drift fence is separately tested and does not reinterpret that valid completed probe. The original 20-page result is development-selected evidence, not another unseen-site test.
