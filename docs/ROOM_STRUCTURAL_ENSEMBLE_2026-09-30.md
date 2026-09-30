# One fixed OLD-interior / NEW-structure ensemble — 2026-09-30

The fixed ensemble is rejected as a detector candidate. On the same exposed procedural development corpus, IoU0.5 recall fell from 86.75% to 53.97%, misses increased from 175 to 608, and extra proposals increased from 134 to 1130. This result does not establish real-sheet accuracy. The single fixed attempt completed without failures, and no tuning/retraining/repeat followed it.

## Declared hypothesis and scope

The completed Swiss true-opening model had weak actual interior predictions. This experiment preserves the OLD long48 stitched/global-fused interior probability head byte-for-byte and copies only the NEW true-opening48 boundary and opening-closure heads byte-for-byte. It uses the previously selected `hierarchical_basins` core/preset unchanged. There are no mixture weights, new thresholds, searches, retraining, GT seeds/crops or changed geometry exports.

This is one original experiment-scoped attempt with separate once-only inference, scoring and qualitative actual phases. Only the exact original 20 context development RGB inputs are inferred by the NEW checkpoint; the OLD probability caches are reused. Procedural instance metrics and floor success apply only to their 1321 source-generated references. These are exposed development cases, not new holdout evidence. The new once-only 20 sites, protected MSD89 pixels and Swiss derived references are never decoded or scored here.

The subsequent A511 hierarchy consumes independently completed OLD and NEW cached maps, using no additional actual GPU inference. No complete real-sheet reference exists; proposal counts, component sizes, holes and overlays can establish rendering/integrity facts and aid qualitative review, but cannot establish recall or every-room completeness. No model is promoted and no production application/database/service changes are part of this experiment.

## Independently pinned provenance

| Input | SHA256 |
| --- | --- |
| OLD long48 checkpoint | `aaa9990485a71a93406bf84ed21871f20721b0981c069247928c379633dd8313` |
| NEW true-opening48 checkpoint | `6e2be29bac8fadce06b103e93e08e4bc32d3e79a7b9258217edc5cb87dcb3aa4` |
| Original context manifest | `79c22af5e8b2faeac31c6b8b290d292dccc5d9c34db542474edaa79b951a4cac` |
| Original OLD map report | `cac68bd373761d21faaa8c7a2a7c7d2ee70ee7a6ef1db4ea64593d478e7a31f3` |
| Original partition binding | `c6de300983e801a7e64e9d9f307009444248ad03b06198682607b360592f680f` |
| Historical hierarchy report | `707cbd22107cedea09bfc018da2f64b0cb30f9b485125271f95d3aa4a56a9e03` |
| Frozen partition core | `49cfc8ea71eadab40428801beb260e7dd03262422233bdf5ae0dc7278fd3d713` |
| OLD actual cached map | `0d486d09885b269a5e4571c7be280a393a0dfa5e50ed5acf19a939521ea2610a` |
| NEW actual cached map | `a3275485370d377e932a6064a46bf600eeb9a7e53c18439910b6e91871a993d4` |
| Clean actual source PNG | `0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828` |

The executable contract also pins both 48-epoch run records, the NEW training binding/completion/original attempt, and the NEW actual binding/completion. All original20 IDs, source/group/site identities, image/reference bytes and OLD map hashes must match both the original context manifest and independently frozen cache/binding reports before any array decoding. Current and archived source hashes plus exact CPU/GPU package/runtime identities are verified before execution and before completion. OLD inference is not repeated, so its historical inference adapter identity stays associated with the pinned cache provenance; NEW inference uses its unchanged current loader.

Private output is `/home/tim/datasets/foremanhq-room-detection/ensemble/fixed-20260930`. The original global claim is `/home/tim/datasets/foremanhq-room-detection/ensemble/fixed-old-interior-new-barriers-20260930.claim.json`; phase claims and final completion receipts use that same experiment prefix outside output directories. A consumed phase cannot be reset by switching/deleting an output directory. Original-path completed receipts pin final report/asset hashes, and a failed/partial phase cannot become completed evidence.

## Preflight validation

Fourteen fabricated CPU tests pass: five exact-copy/invalid-input composition tests and nine metadata, attempt, completion, failure-denominator and native-hole-export tests. No real pixel, probability or reference array is used by these tests. Metadata-only preflight verifies the exact original20 associations and 1321-reference historical denominator. Both runtime package versions match the declared environments; no CUDA availability/device query, GPU inference or reference scoring has happened before source audit.

`contract.py` archives all own Python sources/tests and frozen dependency sources before writing the binding. Source byte changes, substituted cache/source IDs, duplicate coverage, missing audit CLEAR, repeated global phase claims and post-emission byte changes fail closed. Outputs receive immediate SHA256 receipts, checked again before completed markers. All twenty fixed predictions must be exported before the scorer opens any reference. A failed partition contributes zero predictions and every missed reference to the same denominator; partial references abort scoring rather than disappearing.

## Execution and findings

Independent audit CLEAR was received for binding SHA256 `42cc4cfb54d0d4b15eca71c9e68fa2a8a5041b7bbbdb966a6dd1405eb515ec9d` and all 13 source hashes. The independent review verified 77 input byte pins and the exact original20 cases across seven original sites, then reran five focused integrity tests from the fourteen-test suite. A separate reviewer cleared exact-copy composition, failure accounting and metric scope. Both reviews used only source, fabricated fixtures and metadata/byte hashes. The matching private `AUDIT_CLEAR.json` has SHA256 `909c0cf2647a27eddb91835e4ee948424534e9383470c01b2a367e4e344a7516`.

The one authorized inference→scoring→cached-actual sequence completed after this clearance. NEW inference covered exactly the original20 native RGB pages in 60.91 seconds on the pinned RTX5060Ti, with 201.42MiB peak CUDA allocated memory. OLD maps were reused. Fixed CPU composition/partition/scoring took 122.00 seconds. All twenty predictions were exported before the first complete procedural reference was decoded. There were zero inference/partition failures and zero skipped/partial floors; the denominator remained 1321.

| Procedural development metric | Historical OLD hierarchy | Fixed ensemble |
| --- | ---: | ---: |
| Reference / predicted spaces | 1321 / 1280 | 1321 / 1843 |
| IoU0.5 true positives / misses / extras | 1146 / 175 / 134 | 713 / 608 / 1130 |
| IoU0.5 recall / precision / F1 | 0.8675 / 0.8953 / 0.8812 | 0.5397 / 0.3869 / 0.4507 |
| IoU0.75 true positives / misses / extras | 1015 / 306 / 265 | 331 / 990 / 1512 |
| IoU0.75 recall / precision / F1 | 0.7684 / 0.7930 / 0.7805 | 0.2506 / 0.1796 / 0.2092 |
| Merge / split candidates | 27 / 48 | 23 / 348 |
| Zero-miss floors at IoU0.5 | 3 / 20 | 0 / 20 |
| Zero-miss-and-extra floors at IoU0.5 | 0 / 20 | 0 / 20 |
| Zero-miss / zero-miss-and-extra floors at IoU0.75 | 0 / 0 of 20 | 0 / 0 of 20 |
| Failed / partial floors | 0 / 0 | 0 / 0 |

These are generated procedural-reference metrics on exposed development inputs. The four fewer merge candidates do not offset the much larger missed/extra/split counts. This fixed head combination is not promoted; the hypothesis/settings are exhausted for this attempt, with no threshold search or repeated scoring.

The one qualitative A511 cached-map hierarchy completed in 14.66 seconds. It exported 337 unapproved proposals on the exact 5000×3750 native grid, 258 retaining holes. Its largest component has 126569 pixels (0.6750% of the page). These are component/export observations, not a true room count or a completeness claim. Native pixel-cell labels and polygon rings/holes are retained without simplification. The clean source PNG was used only for the debug overlay; no additional actual inference or reference decoding occurred.

Full-page preview QA confirms the expected drawing frame and rendered rings/holes. Object-shaped exclusions and irregular fragmented regions remain visible, including proposals in projecting/diagonal edge areas. This is qualitative falsification, with no new GT labels, room-count certification or real-sheet metrics.

Private review artifacts are `actual/overlay-preview.png`, `actual/overlay-native.png`, `actual/labels.i32`, `actual/rooms.json` and `actual/report.json` under the output directory above. Exact actual ensemble head hashes are:

- OLD interior: `4e39b78766baf0608137d6a1b7c3d3311ebcb91ca120e88c0a90b72d7ce8a81c`
- NEW boundary: `513bf4f1f9ea9bd145675cb362c3eddbd14a1183c5b96326a639ad5a3fdd2450`
- NEW opening closure: `5422ceba66b3e3dfba30561df176edf5c85e31250db9c108b70b66d0675bdd98`

Exact selection equality was checked against the independently pinned source maps at composition, with every native float32 bit preserved. Emitted actual ensemble probabilities have SHA256 `f4858bd72ca447eeeab37268bfaf1c2a51d42b60976a6542ee5ed264000d8ab4`; labels have SHA256 `45a67e1c8af94917bd35735b753c3c401bf31cc6793ab022279e8bc690b95998`; rooms have SHA256 `860143a371eb150cc715f07369b94a0550f2215c9e3ead146fae9117bf1d5a20`.

## Completed immutable evidence

| Phase | Report SHA256 | Completed SHA256 |
| --- | --- | --- |
| Original20 NEW inference | `f9c911bb26bed4825cc3929aaa39a9b71e6365b5513c321f9be2c2052e45b973` | `37a49dd964e4a7138cec8acd80c318565b9c540cc6529301074955f8ffd4c56c` |
| Original20 fixed ensemble scoring | `c223dab263321501fc3cc60655c7342f065dbe547f04ca667781acf29fd5d628` | `44b6e8141b3ae1c2ddf36861ccd258672bd29da6900a89bf2339306b75ece9cc` |
| Cached actual qualitative hierarchy | `795eb5af877357cbb20525f3832403d83e863a6d9535c1a6099b66875620b519` | `c9ccfae25f7141e8d71fa9f86b0c8d0916d3df7dd6660d884dc8f7882e340b43` |

Original-path global final receipt hashes are `e448b56ac27a3b62b5b86b17babab27ba1deab2a84c0e5bec0a4e32b692c3b4f` (inference), `ffed818a447ac92527ee17a20406da71e89cbb4a0dd6deb71096a78e36e13966` (scoring), and `a1f4db5d1592db4f561db835a668b0c4014abb332998cb6b8240a7f98cc59310` (actual). The completed phases bind 44, 124 and 14 emitted file/receipt hashes respectively. Final metadata-only `read_binding`, `completed_phase`, exact inference association/coverage and scoring aggregate/completeness checks all passed against the same original claim, 77 input hashes, archived/current 13 source hashes and unchanged runtimes. This did not rerun inference, partitioning or reference scoring.

Independent final completed-evidence and document review cleared. Reviewers verified the original three phase claims/global completion receipts, all 182 emitted file/receipt hashes, 77 input pins and 13 current/archived source pins. A separate reviewer recomputed both 22-field summaries, per-floor TP/FN/FP invariants/completeness and all 17 historical deltas from the completed original20 metadata; all match. Runtime, peak memory, counts, largest component, raw head/output digests and document claims also match the pinned reports. The independent reviews decoded no arrays, pixels, GT, geometry or models and performed no GPU work. Sources remain frozen at the original preflight hashes; only this evidence prose has been updated.
