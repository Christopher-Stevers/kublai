# Combined room-detection experiments — 2026-09-24

This is an offline research candidate on branch `codex/room-detection-bench`.
The live app, production data, and Opus's checkout were not modified.

## What changed

- Preserve every usable room label in a shared region instead of dropping all but one.
- Combine multiscale ink density with long wall bands and weighted geodesic partitioning.
- Require longer wall support so room-label lettering does not become a solid wall.
- Report rejected/displaced/colliding seeds and inferred boundaries requiring review.
- Reject predictions from runs whose detector files change during execution.
- Add deterministic rotation, scan/noise, and wall-gap stress inputs, plus stricter paired
  outline comparisons. Source snapshots and complete per-case measurements remain local.

## First full development comparison

200 generated ResPlan layouts, 1,331 functional room references, 1024-pixel width.
Known interior label locations were supplied. This does not measure OCR/PDF extraction.

| Detector | F1 @ .50 | F1 @ .75 | Recall @ .50 | Missed | Extra | IoU/all references |
|---|---:|---:|---:|---:|---:|---:|
| Opus raster baseline | 92.50% | 85.20% | 86.63% | 178 | 9 | 77.06% |
| Longer walls + plain distance partition | 98.12% | 90.82% | 97.97% | 27 | 23 | 87.65% |
| Longer walls + density-weighted partition | 98.42% | 92.10% | 98.27% | 23 | 19 | 88.28% |

Density versus plain distance improved four cases at IoU .50 without any case regressing
at that threshold; 27 cases improved outline IoU by over one percentage point, none
regressed by that amount. The dominant gain is preserving labels, with a further measured
benefit from density. The combined candidate still had 15 F1 regressions versus the original
baseline, primarily small kitchens taking excessive adjacent open-plan space. Those were
reviewed for a separate wall-continuation refinement before final holdout evaluation.

The combined candidate had two merge flags and 38 split flags versus 160/0 for the baseline.
These diagnostics are not equivalent to instance errors; detailed thresholds are in README.
The narrow-bathroom regression `resplan-3512` improved from F1 .60 to 1.00, including at
IoU .75, after removing text-as-wall false positives.

On 36 synthetic variants of 12 development cases, F1 rose from 94.36% to 98.81% and F1 @ .75
from 87.27% to 95.24%. These variants are correlated with their parent layouts and must not
be counted as independent architectural drawings. No execution failures occurred.

## Rejected changes

On the 30 lowest-scoring baseline development cases, density-weighted geodesic partitioning
with longer walls reached F1 96.55%. Plateau-aware watershed reached only 79.89%, so it is
retained as an explicitly selected research ablation, not the recommended configuration.
Larger gap-closing factors (2.5 and 4 versus 1.15) both reduced F1 to 96.25%. A stronger
density penalty of 80 offered no F1 benefit over 20 and produced more split flags.

The final attempted refinement extends a wall at a narrow, continuous opening, provided
both resulting regions remain connected to their labels. On a 44-case development challenge
(the 30 hardest original cases plus the 15 first-round regressions, one overlap), it raised
F1 @ .50 from 92.73% to 94.55%, but reduced F1 @ .75 from 83.64% to 79.27% and increased
split flags from 17 to 24. On the stress suite it reduced F1 @ .75 from 95.24% to 93.25%.
It was **rejected for the recommended candidate**; `rectilinearCut` is disabled by default.
Its code/config/tests remain available as an explicit research ablation.

The candidate configuration was chosen before the holdout was started. The machine-readable
selection record is `reports/hybrid-selection.json` in the corpus. Its initial write failed
because the utility used system Python without NumPy; the record was saved with the correct
venv shortly after evaluation launch, before any holdout outcomes were inspected. The record
retains this timing detail. There is no subsequent tuning against holdout outcomes.

## Reserved holdout: frozen candidate

100 previously unused generated layouts, 683 references. One baseline and one selected
candidate evaluation; no tuning or candidate changes followed inspection of these results.

| Detector | F1 @ .50 | F1 @ .75 | Recall @ .50 | Missed | Extra | IoU/all references |
|---|---:|---:|---:|---:|---:|---:|
| Opus raster baseline | 92.79% | 86.73% | 87.55% | 85 | 8 | 78.39% |
| Selected density hybrid | **98.46%** | **92.74%** | **98.24%** | **12** | 9 | **88.68%** |

Merge flags fell from 72 to zero; split flags rose from 1 to 21. There were no execution
failures. At IoU .50, 68 cases improved and six regressed. Outline IoU improved by over one
percentage point on 73 cases and regressed by that amount on one. The reserved split
supports generalization within this source family, not arbitrary construction drawings;
the publisher's near-duplicate caveat still applies.

Baseline holdout run: `20260924T041530-9d8ab8`. Candidate: `20260924T041529-47813c`.
Full reports and the paired comparison are in the local experiments directory.

## Interpretation and remaining acceptance work

The corpus deliberately measures functional rooms: kitchen, living, bedroom, bathroom.
Most previous merges were open-plan kitchen/living pairs, often with no drawn wall between
them. An inferred boundary can improve correspondence with publisher annotations without
proving that an architectural wall exists. Every inferred boundary remains a review item.

The generated drawings are mostly orthogonal, clean residential layouts. The stress suite
only checks a modest 7-degree rotation, mild noise and small gaps. Neither establishes
robustness on arbitrary angled wings, furniture-heavy construction sheets, faint scans,
room-label errors, multiple plans per sheet, or whole-apartment/suite outlines.

Before production integration, validate the correct room/suite target against reviewed
outlines on the nine actual ForemanHQ sheets. Preserve text-layer exclusion in PDF renders,
map output IDs back to original labels, convert masks to appropriate polygons, and bound
resolution or crop contested regions so full-size PDFs do not cause excessive memory use.
The HABS scans and MSD multi-unit corpus remain available for separately annotated tests.

## Recorded first-round runs

Local root: `/home/tim/datasets/foremanhq-room-detection/experiments/`.

- Baseline development: `20260924T040307-622cd7`
- Combined development: `20260924T040308-c4b937`
- No-density development: `20260924T040320-e43392`
- Baseline stress: `20260924T040406-428c34`
- Combined stress: `20260924T040447-bfad6b`

The HTML leaderboard links complete source/config snapshots, overlays and paired comparisons.

## Code and report validation

- 34 TypeScript tests: blur reference checks, barrier/gap behavior, deterministic ownership,
  independent shortest-path oracle, collision diagnostics, geometry/connection guardrails.
- 24 Python tests: scoring, cache/source changes, split isolation, and deterministic stress
  transforms including holes and MultiPolygon geometry.
- Full project TypeScript check passed.
- Browser review verified image panels, seed/collision diagnostics, and stricter paired
  F1/outline comparison columns.

No new runtime dependencies or paid model calls were needed. Measurements use the existing
local Node/canvas and isolated NumPy/Pillow environment. Per-process timing includes startup;
concurrent experiment timings are not a production latency guarantee.

Final source replay: baseline `20260924T041336-e146c5`, candidate `20260924T041530-92be77`.
All 200 candidate masks reproduced the first full development run byte-for-byte. Source and
configuration hashes still matched the frozen selection record after holdout completion.
Machine-readable summaries: `HYBRID_RESULTS.json`; frozen hashes: `HYBRID_SELECTION.json`.

Corpus attribution: [ResPlan](https://github.com/m-agour/ResPlan/tree/e2b78fe069aee1ab1e1828a612743f308e3c32a7),
using publisher geometry under CC BY 4.0. Inputs are our generated monochrome renders and
stress transforms, not redistributed original listing drawings. Corpus metadata and source
license copies live under `/home/tim/datasets/foremanhq-room-detection/sources/`.
