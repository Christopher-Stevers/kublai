# Raw-source proposal diagnostics

This bounded CPU tool measures source evidence inside **already saved** learned
polygons. It is a review aid, not a wall classifier, correctness probability,
accuracy benchmark or geometry editor. It does not call a model, use GPU, access
the database, create ground truth or promote proposals. The two supported inputs
are the immutable exposed page-18 five-view and contrast/local Raster2Seq reports;
other reports/protected corpus data are rejected before pixel decoding.

```bash
/home/tim/datasets/foremanhq-room-detection/models/.venv/bin/python \
  scripts/rooms/proposal-audit/audit.py \
  --trial /home/tim/datasets/foremanhq-room-detection/raster2seq/page18-fixed-five-view-20261002 \
  --out /private/new-proposal-diagnostic
```

Dependencies are the existing CPU NumPy/Pillow/Shapely runtime, also listed in
`../real-sheets/requirements.txt`. A new output directory is required. The tool
pins report/plan/source/proposal/crop bytes, verifies each raw crop pixel-for-pixel
against the original 5000×3750 RGB page, archives its own source and checks all
initial hashes before publishing the report/completion receipt. No learned-input
gamma/resize is used as evidence. Original normalized polygons and native crop
coordinates are retained; no invalid ring repair or out-of-crop clipping occurs.

The source is original PDF page **18**, index **17**, sheet A204 (A511 app name),
PDF SHA `17b15aed60b6b251bfe704a0c2752bab85e196ad3dcfdd2917659bd988991b4f`.
Raw source PNG SHA
`0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828`.
Overlapping views are one source drawing, not independent floors.

## Fixed measurements, no acceptance thresholds

`ink.CONFIG` discloses every measurement parameter:

- Raw PIL RGB luminance levels 64, 128, 192, 224 and 248, reported as a complete
  profile. Faint gray is not discarded by a single black/white decision.
- Both all ink and achromatic ink (maximum RGB channel spread <=16). Colored
  evidence remains visible separately; a colored stroke is not certified markup
  and an achromatic stroke is not certified structural ink.
- Fraction of rasterized polygon-boundary pixels with ink within two native
  pixels. This describes nearby ink, not correct boundaries or genuine doors.
- Longest uninterrupted horizontal/vertical ink run at least two native pixels
  inside the proposal, in pixels and as a fraction of its bounding-box axis.
  Fractions are capped at 1 because rasterized pixel counts include endpoints.
  Holes are removed from interior evidence. No gap closing or scale conversion
  is performed; angled/interrupted walls can be missed.
- Per-view review order is descending maximum achromatic interior run fraction
  at the explicitly declared luminance 224. This is a single exposed inspection
  ordering key, not a learned confidence, detected merge count or pass/fail rule.
  All intensity profiles remain available; no threshold search was performed.

Long interior ink can be an omitted partition **or** an elongated fixture,
ceiling grid, dimension/leader, parking line or hallway marking. A shifted proposal
outline can put a true boundary stroke inside the polygon, also increasing the
signal. A supported outline can still enclose several rooms; an unsupported
outline can be a legitimate virtual doorway closure. Neither high support nor
absence of long ink proves correctness. These features must not automatically
delete, merge, split or approve geometry. Human review and structural vector/door
evidence are still required before closer local inference or corrections.

## Completed exposed-page observations (2026-10-02)

Visual inspection of the saved west-upper and local overlays agrees with the
researcher's conservative result: some proposals follow strong unit/exterior
edges, while faint interior divisions, circulation, fixture splits and exterior
regions remain unresolved. No physical-room counts or accuracy were invented.

The five-view diagnostic audited 60 valid observed polygons, separately counted
30 invalid polygons and 156 line elements. The contrast/local diagnostic audited
119 observed polygons, counted 32 invalid polygons, 233 line elements, and two
valid but out-of-crop polygons that were not audited. These are proposal/view
counts, **not room counts**; overlapping views are not pooled as a dataset score.

Illustrative raw-source measurements (model labels remain unverified):

| Saved view / proposal | Achromatic interior run fraction at 128 | At 192 | At 224 | Boundary-near ink fraction at 128 / 224 |
| --- | ---: | ---: | ---: | ---: |
| Raw west-upper / 11 | .300 | .656 | .656 | .579 / .615 |
| Raw west-upper / 5 | .952 | .952 | .952 | .722 / .924 |
| Gamma west-local / 2, evaluated on raw source | .944 | .944 | .944 | .485 / .740 |

The first row shows additional faint interior evidence beyond a dark-only view.
The other rows show that strong internal ink and faint boundary support are
separate observations. Exterior/parking proposals also rank highly; treating the
ordering as a merged-room classifier would be misleading. The highest-value use
is to open selected proposals over the raw drawing and inspect wall/door evidence,
then use an approved real-sheet key to measure the resulting detector changes.

Private completed reports under
`/home/tim/datasets/foremanhq-room-detection/proposal-audit/`:

| Directory | Report SHA256 | Completion SHA256 |
| --- | --- | --- |
| `page18-five-view-20261002` | `04563a64d95eb852ddff55b88b269d1dbe71de161e6073eae1991c01a566994f` | `432d0a382c86402b247e3dc5b555ec6dd5b5f9769c2e76adf8782df04d3bc4d4` |
| `page18-contrast-local-20261002` | `eeaec7661bf0da65d3c80fbb364f18854b83671c9520052a2dd87aae6a81e4a8` | `661a8bc00048c645c1e73c177425edc76cbf92e7483eb76f729cae07d53cc2f4` |

All current/archive/input/report byte bindings were checked after completion.
An initial CPU pass failed because its output parent did not exist; it published
no report. After fixing directory bookkeeping, the same fixed measurements were
run successfully. No model rerun, preset tuning, protected/newonce data access or
production change occurred.

## Fabricated counterexamples

```bash
/home/tim/datasets/foremanhq-room-detection/models/.venv/bin/python \
  -m unittest discover -s scripts/rooms/proposal-audit -p 'test_*.py' -v
```

Six tests cover faint gray separators, short furniture versus a misleading long
grid, a clear long hallway with supported boundaries and no internal strokes,
colored cloud-like ink, holes, invalid/out-of-crop rejection, and the exact raw
pixel/receipt joins in a small fabricated runner fixture. The grid deliberately
gets a strong long-stroke signal while `wall_crossing_certified` stays false and
`correctness_probability` stays null. This limitation is part of the contract.
