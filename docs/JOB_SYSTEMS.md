# Job systems and specification assessment

A job's **Systems** page connects its specification documents to drawing takeoff. Upload the source files under **Documents → Specifications** (nested folders are included), then choose **Assess specifications**. Assessment runs only when requested. It does not run when a document is uploaded, a drawing opens, or someone changes a filter.

Results are interactive system specifications, stored alongside existing company/job pipe standards. They are not a generated report filed in Documents. The existing company standards continue to work for legacy takeoff. A drawing selection can choose the applicable job system. Its pipe, fitting, valve and joining requirements constrain the catalog candidates for each measured size before material-list creation.

## Reviewing and using a system

Each result includes source passages with immutable document-version IDs, page numbers and section headings. PDFs use physical, one-based pages matching the document viewer. Word/text sources may have section citations without page numbers. The extraction copies the source text; the model selects candidate values rather than writing requirements or invented quotations.

Review the applicable size intervals, component scopes and allowed materials. The system retains multiple permitted alternatives; it never silently picks one when several are allowed. Map unresolved alternatives to the actual catalog's material, category and catalog filters. Type, schedule and standards qualifiers stay visible, as do joining methods. A single clear alternative can resolve automatically after review; competing options require a choice. Confirmed rules constrain the existing part matcher, with size and fitting type checks still applied.

Unreviewed rules, unresolved contradictions, overlapping scopes, ambiguous size limits, inaccessible/stale sources and missing catalog mappings block the affected takeoff lines. Requirements for an unused component group do not block otherwise valid lines. Adding manual rules, editing the system name, correcting requirements, choosing alternatives and suppressing extracted rules are supported. An override is user intent, not a new claim made by the assessment.

Reruns merge into the latest saved revision. They preserve manual corrections, user-selected alternatives, manual names and suppressed rule IDs. Changed source evidence requires review again. Systems no longer identified are retained with a review warning. Source deletion/replacement is recoverable by a document manager; a partial-access member cannot overwrite systems derived from restricted documents. Rule splits, radically changed headings or materially rewritten clauses can become new candidates and need review; deletion tombstones identify previously extracted semantic rules, not every future rewording of the same intent.

## Runtime and access

- Migration `0088_job_system_assessments.sql` adds the job-level assessment status table. Rule data extends existing `pipe_system_spec` JSON. No source files are copied into a second document store.
- `TYPESAFE_API_KEY` stays server-side. The existing TypeSafe System One endpoint and `jev-latest` alias are used. Its returned model ID is recorded. A missing key produces an explicit configuration message; manual setup remains available.
- Only the explicit assessment mutation sends selected specification passages, catalog material names, and narrow typed questions to TypeSafe. PDF/Word text extraction and OCR run locally. No customer document was submitted during development validation.
- Organization membership, dashboard access, job existence, folder ACLs and job-list editing permission are checked. Completion rechecks current access and source fingerprints. Private source titles, status messages and passages are redacted from users without document access.
- Manual saves use optimistic revisions and validate tenant-owned catalog IDs. Assessment commits and saves serialize on the same job lock. Assessment merges the latest row instead of overwriting edits made during processing. Client-provided citations cannot replace the original assessed quote.
- Status survives a browser close. Work runs in a bounded process-local queue (at most four queued/running requests in one application process). It is not an external durable worker queue: an interrupted run becomes retryable after its 20-minute lease expires. Work has a 15-minute execution deadline; source extraction is isolated in a child process with a three-minute timeout and memory limit. A superseded run stops before further provider work.

## Bounds and current limitations

Assessment accepts up to 20 source documents per job request. A PDF reader processes at most 300 pages and 2.5 million text characters per file; at most 12 scanned pages use local Tesseract OCR. OCR, unreadable pages, truncation and unsupported file formats are reported. Searchable PDF, DOCX, TXT and Markdown are supported. Linked Office URLs need an uploaded file. Word pagination is not fabricated.

At most the first 240 relevant passages are assessed, with a visible warning when more are present. Provider requests split at approximately 20,000 question characters and share bounded source context. Large specifications should be split/organized and reviewed carefully; the feature does not claim exhaustive extraction. English is the currently validated language. Unrecognized system names/materials and complex tables can require manual rules. Generic common-system terminology and source headings are used, with no project-specific drawing or equipment tags hardcoded.

Size and material conditions beyond recognized intervals—installation location, differing valve types, conflicting mandatory clauses and methods conditional on material—are preserved as evidence and flagged rather than silently generalized. Catalog mapping initially uses unique exact facet-name/alias matches. It does not invent equivalent materials, guess pressure ratings, or establish engineering compliance. Review the actual project requirements before ordering.

## Validation

- `pnpm exec vitest run src/server/job-systems/analyze.test.ts src/server/job-systems/sources.test.ts` covers size-boundary semantics, alternatives, evidence/page provenance, joining extraction, mixed generic/specific materials, valve scopes, request bounds and source ACL filtering.
- `bash scripts/test-job-systems-db.sh` creates a disposable local PostgreSQL instance. Tests cover tenant/permission checks, missing provider, persisted output, lease reuse/interruption, concurrent correction preservation, changed-source rejection, hidden-source protection, cross-organization IDs, fabricated citations, optimistic save revisions and document-manager deletion/replacement recovery. It never uses `DATABASE_URL`.
- `RUN_REAL_SYSTEMS_ASSESSMENT=1 pnpm exec tsx scripts/test-job-systems-provider.ts` is an explicit synthetic-only provider smoke test. It generates a PDF and temporary private blob, extracts its text, submits only that fixture to the configured provider, maps returned rules and checks the 2-inch copper / over-2-inch carbon-steel boundary after simulated human approval. The latest run used `jev-1.13.0` and produced pipe, fitting, valve and joining rules. This confirms the integration on that synthetic case, not accuracy or completeness on customer specifications.
