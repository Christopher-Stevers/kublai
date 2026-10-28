# Production detection and independent reference data

Updated 2026-10-27. Production uses deterministic text/OCR first, Jev image checks when needed, and the existing budgeted Terra fallback only for unresolved readings. No model result approves receiving. Job boundaries, duplicate checks, source-version checks, returns and human review remain enforced.

## Improvements

- Keep independently numbered rows separate even when supplier line numbers are out of order or repeated. Do not join a new unnumbered SKU/quantity row to a previous product.
- Recover likely source rows under damaged headings. Preserve their text and boxes, including unfamiliar products. Quantities remain null; never infer a column's meaning or a shipment amount from its position.
- Reuse prepared page images and precompute matching tokens, code variants and weights. This changes computation, not matching thresholds.
- Order candidates retain actual units and pack sizes. Candidate-only readings formerly hardcoded every unit to `ea`.
- Keep source descriptions separate from catalog names, along with field evidence. Preserve printed, derived and unread quantities distinctly. Missing units and receipt discrepancies remain human decisions.
- Poor OCR transcription alone does not escalate a product that Jev has already matched confidently. An unmatched product with unclear source wording remains flagged for a better reader.
- Pin text and image Jev to the same model version. Preserve error attempts as unknown usage rather than reporting zero cost.

## Measured checks

The frozen 240-PDF corpus was replayed locally with models disabled. Candidate order decisions were held fixed for the parser comparison. Before: 101 PDFs had no OCR product rows. After: 27. Recovered row candidates do not constitute verified detections: they have no inferred shipped quantities and require image/human review. The number of non-null OCR shipped quantities remained 878. Row crops increased from 654 to 1,495 after fixing unwanted joins and adding candidate recovery.

Five representative real slips were scored against the same frozen job orders before and after the matching optimization. Every ranking and score was identical; total matching time fell from 4,137 ms to 1,870 ms (about 2.2 times faster). These are local measurements, not a device-wide latency claim.

A live-data preview on ORDER-159 read all five source rows using 13 Jev calls, estimated at USD 0.007817; Terra was not needed. Source descriptions, confidence, candidate orders and image evidence were saved. The job workspace and received/returned/credited totals were unchanged. An earlier development preview exposed the unnecessary OCR-text escalation; that was corrected before release. Neither preview approved any delivery.

The 240-slip replay and previews do not establish accuracy or calibrated confidence. Human-verified labels are still needed, including line omissions, incorrect order matches, units, returns and duplicate decisions. Supplier families, revisions, repeated scans and retries must stay together when splitting development and held-out data.

## Private evidence format

Every new production reading freezes its reference inputs before model reading, including when Terra is skipped:

`uploads/job-documents/.detection-runs/<organization>/<job>/<run>/<attempt>/input.json`

The file identifies the immutable source hash/version, original-page image hashes, coordinate convention, candidate orders and pack units, source warnings, capture time and provenance. The candidate allowlist excludes received quantities, review status, return/credit outcomes and prior predictions. Original ordered quantities are retained. Current catalog aliases are frozen as part of candidate context; they are not independently verified source transcriptions.

`result.json` retains independent stage predictions, stable evidence-row IDs, confidence with its basis, printed/derived field evidence, routing decisions, calls/usage, latency timestamps and release/reader versions. Scores remain uncalibrated. A source box or row split change requires explicit alignment; a shared product ID is insufficient. Raw provider questions, answers and image crops are stored in private `.review-evidence` attempt records. The legacy run filename points to the latest trace; immutable attempt files retain earlier retries.

A cached reading records its source run/document without repeating extraction or paid calls. Cached, incomplete and retrospective records are excluded from new independent evaluation samples by default. Development previews are marked separately. Originals and predictions are never overwritten by later reviews.

## Export skipped Terra cases

With the server environment loaded (credentials stay server-side), set `JOB_DOCUMENT_STORAGE_ROOT` to the actual document-storage directory and run:

```sh
node --conditions=react-server --import dotenv/config --import tsx scripts/export-packing-slip-detections.ts ORGANIZATION_UUID JOB_UUID NEW_PRIVATE_FOLDER
```

The command performs no API calls and changes no receipts. It exports completed production attempts that have no attempted or reused Terra reading. `--include-development` is only for export validation. The new output directory must not already exist.

- `manifest.json`: pending reference cases, exact input hashes, excluded cases/reasons, source-family identifiers; dataset split remains unassigned until duplicate/family grouping is frozen.
- `reference-inputs/`, `assets/`, `output-schema.json`: the only files supplied to the independent external reader. Source filenames and pre-linked order IDs are excluded because they may encode earlier answers. Oversized candidate pools must be explicitly handled by the external runner, never silently truncated.
- `predictions/`: production inputs, predictions, raw traces and model image crops, reserved for the evaluator.
- `human-review/events.jsonl`: separate dated review events tied to document/version/run. A receiving decision is not automatically a label for printed shipped quantity. Use only explicitly checked fields and preserve the distinction between printed, handwritten and physically received amounts.

The independent reference instructions require every product row, unknown products, abstention and confidence for product transcription, quantity and matching. They exclude earlier predictions and human labels. This differs intentionally from the production fallback, which sees prior readings to resolve specific issues.

## Validate later external results

Save an external response envelope with `caseId`, `inputSha256`, `model`, `reasoningEffort`, `startedAt`, `completedAt`, raw provider `usage`, and `output` conforming to `output-schema.json`. Preserve the raw model response separately as well. Run:

```sh
node --import tsx scripts/import-packing-slip-reference.ts PRIVATE_BUNDLE RESPONSE_JSON --validate-only
node --import tsx scripts/import-packing-slip-reference.ts PRIVATE_BUNDLE RESPONSE_JSON
```

Validation checks source/input hashes, page evidence, schema, confidence ranges, job candidate orders and item ownership. Accepted results are immutable, separately named records inside the private bundle. It never imports a receipt or approves an order. Repeating an identical import is idempotent; changed predictions are retained separately. Model output remains unverified until compared with explicit human labels.

Collecting these records does not itself train a model or validate escalation thresholds. Evaluate part matching, quantity, unit, row coverage and order identity separately, then measure accuracy and cost on held-out source families before changing production policy.
