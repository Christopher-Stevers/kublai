# All-space room detection evaluation

There are two complementary evaluations in this directory:

- `evaluate.py` measures the frozen generated Modified Swiss Dwellings corpus.
  Its renders and optional supplied label seeds do not establish accuracy on
  customer PDFs.
- `evaluate_feedback.py` replays privately exported real drawings against room
  reviews. It can establish complete-floor metrics only after a user explicitly
  checks the whole floor and adds missing rooms.

## Build verified real-drawing examples

Review every proposal in the app. Correct boundaries, disapprove incorrect
proposals, and manually add missing spaces, including unlabeled corridors and
common rooms. A merged proposal may contain several real rooms: disapproving it
does **not** mean its pixels are non-room background. Confirm the floor only
after checking the entire drawing and acknowledging completeness.

The version-2 exporter preserves immutable review-time polygons, corrections,
holes, rejection reasons, and all current approved rooms for each floor. It
copies the preview and exact source PDF into a new private directory with
SHA-256 hashes and the actual source PDF page number. Source drawings retain
their original annotations and must remain private.

Run from the repository with the existing server environment configured:

```bash
node --import tsx scripts/rooms/export-feedback.ts ORGANIZATION_UUID /absolute/private/feedback-snapshot
```

Replace `ORGANIZATION_UUID` and the destination. The destination must be new.
This is the only step that reads the database. Evaluation itself does not read
`.env`, connect to the database, invoke a provider, or send files elsewhere.
Keep exports, predictions, reports, and trained customer models outside Git.

## Repeat the development loop

Use the corpus Python environment, which contains NumPy, Pillow, and Shapely.
On this machine it is
`/home/tim/datasets/foremanhq-room-detection/.venv/bin/python`.

```bash
python scripts/rooms/complete/evaluate_feedback.py \
  --export /absolute/private/feedback-snapshot \
  --output /absolute/private/replay-baseline
```

The default `--input production` uses the copied PDF, extracts physical room
anchors, removes the text layer, renders at the production 5000-pixel long side,
and runs the same `detectAllSpaces` implementation. It scores the returned
candidate polygons, including holes. It does not apply database reconciliation
or organization rejection memory, so rejection reemissions remain visible as
raw detector quality evidence.

For image-only experiments, use `--input preview` explicitly. Preview results
cannot be called production PDF or OCR accuracy. Neither mode receives seed
points generated from reviewed ground truth.

Freeze the export. Run a baseline before changing detection, then compare a
candidate on the same development split:

```bash
python scripts/rooms/complete/evaluate_feedback.py \
  --export /absolute/private/feedback-snapshot \
  --output /absolute/private/replay-candidate \
  --compare /absolute/private/replay-baseline/report.json \
  --fail-on-regression
```

Reports contain one-to-one room IoU matching at 0.50 and 0.75, missed and extra
rooms, merge and split candidates, mean boundary IoU including missed rooms,
replay latency, source hashes, and per-floor regressions. Failures count as
misses on complete floors. A report with no complete floors has
`all_space_summary: null`; its accuracy remains unknown.

On partial floors, the report contains only recovery of reviewed positive
examples and reemission of reviewed rejected proposals at IoU 0.65. It never
counts unreviewed spaces as false positives or presents positive-only matching
as all-space recall. Rejection evidence measures proposal quality and is not a
negative segmentation mask. Only complete, explicitly attested approved floor
snapshots can supply full room ground truth for segmentation training.
The completeness snapshot and every scored review must also identify the exact
source drawing SHA-256. Legacy reviews with an unknown or different source hash
remain in `unverifiedExamples`; they do not enter accuracy or training examples.

Every floor from one job receives the same deterministic development or holdout
split. Include only development jobs when fitting any model or tuning thresholds.
Only after freezing a candidate, run its held-out check:

```bash
python scripts/rooms/complete/evaluate_feedback.py \
  --export /absolute/private/feedback-snapshot \
  --output /absolute/private/replay-holdout \
  --split holdout --allow-holdout
```

Do not tune on holdout results. A later experiment needs a fresh untouched
holdout if earlier holdout failures influenced its design. Comparisons require
identical reviewed data, selected floors, input mode, and split. Changed drawing
bytes, ground truth, source code during a run, path escapes, malformed polygons,
or mixed job splits make evaluation refuse to report a rankable result.

The complete-floor assertion is supplied by a person; it is not independent
proof that every space was labeled correctly. Audit difficult floors and use
independent reviewers before treating their scores as a business accuracy claim.

## Measure entire-floor success

Average room F1 can conceal a missed hallway on every drawing. Derive a separate
whole-floor summary from a frozen evaluation report without rerunning a detector
or reopening reference images:

```bash
python scripts/rooms/complete/report_completeness.py \
  --report /absolute/private/replay-candidate/report.json \
  --output /absolute/private/replay-candidate/completeness.json
```

The output records the original report SHA-256 and, at IoU 0.50 and 0.75, the
fraction of nonempty complete-reference floors with zero missed spaces and the
fraction with neither misses nor extra proposals. Failed complete-floor runs
remain in the denominator and cannot count as successes. Partial reviews and
empty reference floors cannot establish every-room success. Counts must be
internally consistent. This helper relies on the source report's existing
ground-truth/provenance checks; it cannot turn a synthetic corpus or incomplete
annotation into construction-sheet accuracy. It also supports paired model
reports with a `results` map of candidates.

## Verification

```bash
python -m unittest discover -s scripts/rooms/complete -p test_evaluate_feedback.py -v
python -m unittest discover -s scripts/rooms/complete -p test_report_completeness.py -v
```

Tests cover holes, missing rooms, partial-review safety, merged-proposal rejects,
explicit completeness, stale drawings, grouped splits, hash/path integrity,
regression comparisons, and both offline adapters. The synthetic PDF pipeline
fixture uses ReportLab; it checks source-page selection and filtering of
apartment occupancy descriptions without claiming live detection accuracy.
