# AI assistance workspace retired

On 2026-10-10, Tim requested removal of all six AI assistance tools: material finding, supplier matching, catalogue organization, material-list checks, drawing classification and room-outline review.

Their interface, entry links, API router, TypeSafe client, cache, PDF text worker and dedicated tests have been removed. Old `/dashboard/assist` bookmarks redirect to Jobs. No database migration is required; these tools did not persist changes. Existing room detection and normal catalogue, supplier, material-list and drawing tools remain independent.

The application no longer reads TypeSafe environment settings for this workspace. The project TypeSafe skill remains available for any future explicitly requested integration.

## Packing-slip receiving review (2026-10-17)

The retired assistance workspace remains removed. A separate, narrowly scoped packing-slip review now uses TypeSafe after a linked slip is saved.

- Server-only `TYPESAFE_API_KEY` enables `jev-latest` at the official System One endpoint. The browser never receives credentials.
- Scanned pages are read locally with Tesseract (English data required). PDFs render in a bounded child process using the existing PDF.js/canvas dependencies. Up to 20 pages and 150 text rows are analyzed; omitted/unreadable pages and rows are reported.
- The service sends recognized text, table positions, and candidate order descriptions/SKUs/aliases to TypeSafe. Choice answers select existing numeric spans and candidate items; model-generated quantities are never used. Exact SKU and explicit column matches use code. Unclear quantities, ambiguous units, duplicate lines, and nonmatching items stay flagged rather than being filled in.
- All quantities are proposals. The user checks the physical delivery and confirms received quantities. Confirmed amounts add to earlier receipts; a transaction rechecks permissions, document version, current order contents and existing received quantities. A persisted application receipt prevents repeated submissions from counting the same document twice. A fresh photograph of an already received physical slip is not reliably recognized as a duplicate; prior receipt totals and a warning remain visible.
- Receipt analysis and confirmation evidence live on the linked document in the existing job-document workspace. PDF saving succeeds independently of analysis. Failed/interrupted runs can be retried; manual verification remains available.
- Runtime jobs are serialized and bounded in the application process. An interrupted processing lease can be retried after 15 minutes. This is not a durable external worker queue.

Validation: isolated PostgreSQL tests cover confirmation/idempotency/conflicts/permissions. A synthetic scanned PDF was read with real Tesseract and the configured TypeSafe service: 6 shipped/4 backordered and 8 shipped/0 backordered matched the test order; an unordered extra item was flagged. This fixture verifies the integration, not general accuracy on supplier documents.
