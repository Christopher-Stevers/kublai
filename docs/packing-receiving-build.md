# Packing-slip receiving

Implementation and verification: 2026-10-27.

## Behaviour

The job receiving queue is `/jobs/[jobId]/receiving`. Existing scan entrypoints, packing-slip panels and document details open the same review. A PDF is one slip with multiple pages. Multiple deliveries and returns can belong to one order. Order searches and receipt changes stay within the current job.

Reading creates proposals. Nothing is received until a person explicitly approves selected ready lines. Unresolved lines stay in the shared queue with their scanner, source page/crop and issue. The reviewer can show or hide actual background progress, leave the page and return later. All-page confirmation prevents silently treating a partially read document as complete.

Duplicate scans require a reasoned choice: supporting document, replacement of the original, or a distinct delivery. Replacing a slip carries forward its receipt baseline; a later approval applies only the difference. Request IDs, source versions, review revisions, order fingerprints and transaction locks prevent repeated or stale approvals. The old manual receiving controls cannot overwrite quantities already managed by an approved slip.

Rereading and clearing predictions preserve human edits and approved receipts. Old source crops remain attached to old decisions. A source-file revision requires explicit adoption and reconfirmation. Correction of an approved receipt requires a reason and records the quantity delta. Returns for replacement reopen the quantity due; returns for credit reduce it. Mixed delivery/return lines are supported. Original ordered quantities remain recorded.

Executive accounts, the job foreman and foreman/lead-hand roles with receiving access can approve new organization catalogue parts and suppliers, attach an extra order line, or reconstruct an already-placed order in an existing/new material list. Part details are proposed from the slip. Photos are proposed from known organization images; a missing image remains missing. Shared records require approval. Price snapshots remain on the job order/list, never the global catalogue cost. Reconstruction sends nothing to suppliers and does not receive anything by itself. Email ingestion is outside this workflow.

## Cost and learning

The reader tries native PDF text/local OCR and deterministic matching first. Clear, consistent exact-SKU rows can bypass Jev. Uncertain scanned rows use Jev; ambiguous quantities, units, order identity and products remain review items. OCR is cached by source hash and reader version. Identical-source reuse copies predictions only, never receipt approvals.

Published prices checked 2026-10-27:

| Option                              | Input per million tokens | Output per million tokens | Use                                         |
| ----------------------------------- | -----------------------: | ------------------------: | ------------------------------------------- |
| Local deterministic code/OCR        |      No model API charge |       No model API charge | First pass; still consumes server resources |
| Jev                                 |                   $0.042 |                        $0 | Uncertain extraction/matching               |
| GPT-6.1 Terra, standard API pricing |                    $1.00 |                     $5.00 | Development comparisons only                |

Sources: [TypeSafe pricing announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [OpenAI API pricing](https://developers.openai.com/api/docs/pricing). These are per-token comparisons, not a guarantee of total cost per slip. Image tokenization, retries and number of calls affect the total. Codex subscription usage is not billed using these API estimates. No Terra API integration is shipped in this release.

Each reading preserves reader version, questions, raw responses, crop hashes, timing and returned usage privately in document storage under `.review-evidence`. Missing usage remains unknown, never zero. Human decisions and corrections are append-only history and remain separate from the raw predictions. Confirmed supplier SKU mappings improve future deterministic matches; conflicting corrections are excluded from automatic matching.

`scripts/export-receiving-evaluation.ts` exports a job's private evidence for future development supervision. Duplicate/replacement groups stay together in a deterministic 80/20 development/held-out split. A received quantity is not automatically a correct transcription. Frontier labels require source verification; proposed rule/prompt changes must pass held-out wrong-order, duplicate-receipt and quantity tests before release. There is no automatic model training or production rule promotion.

## Verification

- 111 unit and UI checks passed across 15 files.
- 37 isolated PostgreSQL checks passed for review history, permissions, stale/concurrent approvals, duplicate replacement, corrections, returns, source adoption, units, shared records and reconstruction.
- 43 isolated PostgreSQL purchasing checks passed.
- TypeScript passed. Full lint still has existing repository debt; comparison with the base commit found zero introduced lint errors. The repository-wide lint command does not pass.
- Real uploaded corpus: all 240 live packing-slip PDFs (348 pages) completed local OCR with zero extraction failures. None had useful embedded text. 101 had no confidently recognized deterministic table; five showed return-header evidence. These counts are not measured matching accuracy.
- Three read-only live Jev runs exercised unknown-order extraction. Two small slips used 7 and 6 calls, cost estimates $0.002442 and $0.001674, and took 8.5 and 11.7 seconds. A return slip used 42 calls in 38.2 seconds; one failed call omitted usage, so its total cost remains unknown. This is a small operational sample, not proof of full-corpus accuracy. No live receipt quantities were changed by these evaluations.
- Actual review UI checked at 390×844 and 1440×960 with explicitly labelled example data, including partial approval and persistent unresolved lines. The authenticated production workflow is additionally checked read-only at release.

## Release

Run the bundled background worker with `--check` under the production environment before switching releases; this catches dependencies that only fail outside the web bundler. Keep legacy receipt seeding in `review-draft.ts` so the worker never imports the receiving HTTP/catalogue router.

Build web and background worker from the same clean commit on `packing-receiving-review`, excluding the paused in-app Terra comparison draft in the primary checkout. Apply only additive `drizzle/0097_receiving_returns.sql`; migration 0096 belongs to that paused draft and must not be applied as part of this release. Both returned/credited columns default to zero, preserving existing receiving quantities. Unlinked slip-reading jobs are now allowed.

Deploy versioned web and worker directories by swapping `.next` and `.background/current`, retaining their previous targets for rollback. Verify idle background work first, preserve a private receiving/workspace snapshot, check both services and database health, and compare live receipt totals before/after. The deployment record is private in `.tmp/receiving/deployment.json`.

The remaining accuracy work is supervised evaluation on verified real slips and targeted improvements from those findings. The queue deliberately keeps uncertain work visible; this release does not claim every supplier format is read correctly.
