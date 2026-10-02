# Real-sheet review scoring

This offline scorer compares **saved proposals** with private, human-reviewed
polygons. It does not run detection, read/write the database, train a model,
approve rooms, deploy the app, or score a protected holdout. It reuses the
existing normalized polygon, hole-preserving intersection and maximum-cardinality
one-to-one matching utilities in `complete/evaluate_feedback.py` and
`bench/metrics.py`.

The target must be explicit: `physical-spaces` means each individual physical
room and common space; `units-and-common` means one instance per apartment/suite
plus common spaces. A suite and its internal rooms cannot be interchangeable
answer keys. Every comparison set has one policy. The product policy and ship
thresholds need confirmation; this scorer does not choose them.

## Current review availability

A read-only repeatable-read aggregate on **2026-10-02 22:53:51 UTC** found three
rejected events, three rooms, one floor and one job, all carrying a drawing hash;
zero approved events. There were nine floors, zero confirmed floors, and zero
completeness attestations. Current room rows were 259 pending (218 hash-bound)
and three rejected. No customer names, geometry, source assets or credentials
were queried. This is a dated availability check, not a claim about future data.
There is currently no complete real-sheet answer key on which to claim accuracy.

The current `export-feedback.ts` output hardcodes `target: physical-spaces`.
That field alone does not prove what the user reviewed. The adapter requires an
operator to confirm that target and will not convert a suite review to a physical
room review. Exported app names are intentionally omitted, so naming accuracy
is unavailable from this adapter unless a separately reviewed answer key adds
names/aliases.

## Run

Use a private environment outside Git (Python 3.11+):

```bash
python3 -m venv /private/room-score-venv
/private/room-score-venv/bin/pip install -r scripts/rooms/real-sheets/requirements.txt
/private/room-score-venv/bin/python scripts/rooms/real-sheets/score.py \
  --manifest /private/real-sheets/candidate/manifest.json \
  --out /private/real-sheets/scores/candidate --boundaries
```

The manifest and all drawing/reference/prediction bytes remain outside Git.
Outputs require a new directory; files use mode 0600, directories 0700. A single
command prints a per-sheet table and writes `report.json`, transparent SVG
comparison overlays, and `COMPLETED.json`. SVGs use the full original page frame
and can be placed over the exact corresponding page image. They contain reviewed
geometry, not a newly inferred or generated answer key. The scorer never renders
a PDF or decodes an image. Green outlines match; red are complete-reference
extras/bleed candidates; blue are unclassified proposals on partial/empty
references; dashed grey outlines are references, including misses. Excluded
proposals/areas are grey. Mask-removal fractions are recorded in JSON.

To compare two completed candidate runs with exactly the same references:

```bash
/private/room-score-venv/bin/python scripts/rooms/real-sheets/score.py \
  --manifest /private/real-sheets/candidate-b/manifest.json \
  --out /private/real-sheets/scores/candidate-b --boundaries \
  --compare /private/real-sheets/scores/candidate-a
```

The comparison reports per-sheet deltas rather than hiding regressions in a
global average. It requires identical reference bytes, target, original pages,
runtime, scorer sources and optional boundary setting. Completed readers verify
all input/output bytes and the original output directory; copying a report folder
does not recreate valid completion. **After changing the scorer or its helpers,
re-score both candidates.** Repeated development scoring is intentional.
Holdout/protected scoring needs a separately approved once-only selection
protocol; this tool rejects `holdout` and nondevelopment metadata before reading
reference geometry. Callers must not falsely relabel a protected dataset as
development. No protected89/newonce20 files are inputs to this work.

## Private manifest and geometry format

`manifest.json`:

```json
{
  "version": 1,
  "split": "development",
  "targetPolicy": "physical-spaces",
  "cases": [{
    "siteId": "private-project-key",
    "split": "development",
    "source": {"pdfSha256": "<64 lowercase hex>", "originalPageOneBased": 18},
    "reference": {"path": "floor.reference.json", "sha256": "<exact file SHA>"},
    "prediction": {"path": "floor.prediction.json", "sha256": "<exact file SHA>"}
  }]
}
```

Paths are relative, resolve inside the private manifest directory, and may not
escape through a symlink. The exact same PDF hash must retain the same site key
across every page; duplicate PDF/page aliases are rejected. The hash of the
original PDF, its **original one-based page**, and the full-page coordinate frame
must agree between reference and prediction. An optional `originalPageIndex`
must equal the one-based page minus one. An app import slot is not this field:
the exposed A511 example is original PDF page 18/index 17, while its database
`pageNumber` is 19.

A reference contains:

- `version: 1`, `sheetId`, `siteId`, `targetPolicy`;
- `source: {pdfSha256, originalPageOneBased, pdf: {path, sha256}}` with the exact
  privately copied PDF bytes; no PDF decoding is needed;
- `coordinateFrame: {coordinates: "normalized-original-page", width, height}`;
- `rooms`: unique `id`, `kind` (`room`/`common` for physical, `unit`/`common` for
  units), optional `name`/`nameAliases`, and `shape`;
- `exclusions`: unique `id` and `shape` for deliberately ignored balconies,
  shafts, outside areas, etc.; `rejected`: unique `id`, `shape`, optional
  `reviewReason` for immutable rejected proposals;
- `review` as described below.

Shapes use the existing app format:
`{type: "polygon", points: [{x,y}, ...], holes: [[{x,y}, ...], ...]}` with finite
normalized x/y in [0,1]. Bounding boxes in the existing explicit app format are
also accepted. Invalid/self-intersecting geometry is rejected, never silently
repaired. Reference instances cannot overlap or nest. Holes and exclusion-created
disconnected components remain part of the original instance.

`review` requires `scope` (`complete-sheet` or `reviewed-subset`), `reviewer`,
`reviewedAt` with timezone, and nonempty `provenance`. It also carries
`pdfSha256`, `originalPageOneBased`, `targetPolicy` and
`reviewedSnapshotSha256`. The snapshot hash is `score.snapshot_hash(reference)`:
canonical sorted JSON over sheet identity, source, coordinate frame, policy,
rooms, exclusions and rejections. This records which exact geometry the human
assertion refers to; it is **not cryptographic proof of independent approval**.
A human must actually check all intended spaces/missing rooms before choosing
`complete-sheet`. Editing geometry or masks requires a new review assertion.

A saved prediction has matching `version`, `sheetId`, `source`,
`coordinateFrame` and `targetPolicy`, plus:

```json
{
  "producer": {"name": "candidate-name", "sourceSha256": "<detector source SHA>",
               "configSha256": "<fixed config SHA>"},
  "status": "completed",
  "execution": {"elapsedMs": 1234, "peakRssBytes": 123456},
  "rooms": [{"id": "proposal-1", "name": "Optional name", "shape": {"type": "polygon", "points": []}}]
}
```

The empty points above illustrate the field only; valid rings need at least
three points. A detector failure uses `status: failed`, an explicit `error`, and
`rooms: []`. It contributes every complete nonempty reference as a miss.
Missing reference bytes or malformed reference geometry instead fail the score;
they cannot be counted as detector quality. Runtime/RSS are saved measurements,
not measurements of this scorer.

## Existing app feedback and saved trial path

The standard private feedback export is `scripts/rooms/export-feedback.ts`.
Run it only with the authorized organization ID and a new private destination;
it reads a repeatable-read snapshot and copies exact source PDFs. Do not run
`check-review-db.ts` for an availability check; it performs database changes.

The adapter uses `sourceDrawing.pageNumber`, not the floor import slot. It
checks optional event source pages, source verification and current approved
snapshot equality. Complete references require the existing current-source
completeness contract; legacy confirmation alone stays partial. Whole-PDF aliases
of holdout jobs are quarantined before any polygon helper or asset copying.

For an **already completed** `physical-eval.ts` trial, wrap a saved mode without
re-running the detector:

```bash
mkdir -m 700 /private/saved-predictions
/private/room-score-venv/bin/python scripts/rooms/real-sheets/wrap_trial.py \
  --trial /private/existing-physical-eval-trial \
  --feedback /private/review-export/feedback.json --floor-id <EXPORTED_FLOOR_ID> \
  --mode physical --target-policy physical-spaces \
  --out /private/saved-predictions/<EXPORTED_FLOOR_ID>.json

/private/room-score-venv/bin/python scripts/rooms/real-sheets/prepare_feedback.py \
  --feedback /private/review-export/feedback.json \
  --predictions /private/saved-predictions \
  --confirm-export-target physical-spaces --out /private/real-sheets/candidate

/private/room-score-venv/bin/python scripts/rooms/real-sheets/score.py \
  --manifest /private/real-sheets/candidate/manifest.json \
  --out /private/real-sheets/scores/candidate
```

Provide one saved prediction file for each eligible reviewed floor. The wrapper
verifies the original trial PDF, original page, plan/completion association,
unchanged source inventory/archive and emitted result hashes. It preserves
timeouts/failures as failures. Known producer semantics are enforced:
`physical` requires `physical-spaces`, and `tagged` requires `units-and-common`;
an operator cannot relabel either mode with a target flag. The current tagged baseline groups suites and must be evaluated
with a matching suite/common answer key, not the physical-spaces export adapter.

`prepare_feedback.py` copies source/proposal bytes into a new private directory,
records the original export SHA and source pins, and writes the score manifest.
It never loads images, invokes models, or changes the DB. It preserves partial
and rejection-only evidence; if nothing source-verified is eligible, it fails
instead of inventing a reference. Feedback names are unavailable, and rejected
shapes are not painted as ground-truth background.

## Metric meanings

- IoU 0.5 and 0.75 use a maximum-cardinality one-to-one match. One merged proposal
  cannot receive credit for two reference instances. Misses are unmatched
  references; extras are unmatched proposals **only on complete nonempty keys**.
- A bleed candidate covers at least 50% of at least two references. A split
  candidate has at least two proposals covering 15% each, with summed coverage
  at least 50%; these are diagnostic candidates, not certified error causes.
- Exclusions are subtracted from both references and proposals before matching.
  Fully ignored instances and every removal fraction are reported separately.
  Changing a mask changes the reviewed snapshot and reference set identity.
- Partial references report only recovered/missed reviewed positives and
  re-emission of exact reviewed rejected proposals. Unreviewed areas stay unknown:
  no whole-sheet recall, precision, junk, floor completeness or F1 is reported.
- Rejection matching follows review memory: IoU >= .65 only for `not-space`;
  boundary/merge/split/unspecified reasons use >= .98. Each rejected row records
  its reason, threshold and matched candidate IDs. A useful boundary repair at
  .8 IoU is not a re-emitted boundary rejection. These are proposal-level checks,
  not pixel background labels.
- Zero positive reference produces `insufficient-positive-reference` and null
  whole-sheet metrics, even with an asserted complete review and no proposals.
  Empty/fully excluded keys never contribute a perfect score.
- Naming uses only named IoU-.5 matches, NFKC/case/whitespace normalization and
  explicit aliases. Missing names do not create a fabricated naming percentage.
- Optional boundary error is symmetric boundary Hausdorff distance (including
  holes), normalized by the original page diagonal; it is not a millimetre or
  drawing-scale error. It covers matched instances only; misses remain misses.
- Human correction time is not inferred from event timestamps. A separate timed
  review is needed to evaluate the proposed five-minute product gate.

## Fabricated verification

```bash
/private/room-score-venv/bin/python -m unittest discover \
  -s scripts/rooms/real-sheets -p 'test_*.py' -v
```

Tests use invented polygons and nondecoded PDF-like bytes only. They check
partial/zero-ground-truth restrictions, exclusions, holes, one-to-one merge/split
matching, policy/page/hash mismatch, saved failures, naming/boundaries,
reason-sensitive rejection replay, export-to-score conversion, whole-PDF holdout
alias quarantine before geometry, saved trial wrapping, and late input/output
drift. They do not establish real-sheet detector accuracy.
