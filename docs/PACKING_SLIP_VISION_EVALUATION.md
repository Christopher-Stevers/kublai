# Packing slip image evaluation — 2026-10-21

Codex tested Jev 1.14.0 image input at Tim's request. This is an offline evaluation,
not an enabled production receipt feature. No receipt, order, or saved analysis
was changed. Hosted Qwen remains stopped as requested.

## Method

Used the five unresolved rows from the latest saved 19-row packing slip. Sent
only cropped rows, their column-heading images, and candidate order descriptions,
SKUs and aliases to TypeSafe. Each request asks two independent Choice questions:
identify the product and select the printed shipped quantity. Both include an
unclear/no-match option. Handwritten delivery counts are not treated as printed
shipped quantities or proof of actual receipt.

The quantity options come from existing slip/order values and decimal-shift
alternatives. This is candidate selection, not arbitrary number transcription.
A correct value missing from the options cannot be recovered by this method.

## Observed results

| Printed row | Visual reading of product | Printed shipped quantity | Jev result |
| --- | --- | --- | --- |
| 7 | 2-inch XFR 90 | 25 | Matches visual reading |
| 11 | 3-inch XFR 90 | 25 | Matches visual reading |
| 12 | 3-inch XFR 45 | 25 | Matches visual reading |
| 16 | 4-inch XFR 45 | 25 | Matches visual reading |
| 18 | 4-inch XFR wye | 10 | Matches visual reading |

Codex inspected all five actual image crops. These are not human-confirmed
receipt labels, nor confirmation of supplier-code equivalence beyond the visible
product descriptions. A second live run returned the same part and quantity
choices. Initial requests took 282–439 ms each (1.72 seconds total API time),
using 33,909 total input tokens. Timing excludes page rendering and crop creation.

A negative control removed the correct product and quantity options for row 7.
The model chose unclear for both. One such control does not establish the false
positive rate. Both trials used the same source slip and supplier format; this
is not a broad supplier benchmark.

## Reproduce

`scripts/bench/packing-slip-vision.mjs` takes four arguments:

1. Baseline analysis JSON with lines and header boxes.
2. Original export JSON with `doc.packingSlipAnalysis.items`.
3. Directory containing upright `page-1.png`, `page-2.png`, etc., rendered with
   the same coordinate system used to obtain the normalized boxes.
4. Private output directory (use `.tmp/`; results include business data).

The runner uses the server's `TYPESAFE_API_KEY`, pins `jev-1.14.0`, sends the
image opt-in header, validates returned choices and confidence ranges, and caps
the evaluation at ten unresolved rows. It does not access or mutate the database.
It skips rows without image boxes or same-page column-heading evidence.
Local evidence is in `.tmp/slip-vision/`: original and repeat results, crops,
and the negative-control result. Private source documents are not committed.

## Before production suggestions

Evaluate more supplier layouts and independently confirmed corrections, including
blank/blurred crops, wrong products, missing candidates, units/packs, partial
shipments, handwriting, and repeated lines. Preserve original OCR and separate
vision evidence. Use successful image checks only as reviewable suggestions;
provider failure must leave current results intact. Do not calibrate an automatic
acceptance threshold from these five examples or treat model confidence as proof.

Current references read for this evaluation:
- https://docs.typesafe.ai/images
- https://docs.typesafe.ai/api/system-one
- https://docs.typesafe.ai/primitives/choice
- https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook

TypeSafe labels image input experimental. Current documented image bounds are
280–1568 pixels per side; the runner pads small crops and bounds larger ones.
