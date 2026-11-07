# Job systems and specification assessment

A job's **Systems** page connects selected documents and drawing sets to drawing takeoff. Under **Assessment sources**, select individual accessible job documents and/or whole drawing sets, then choose **Assess Sources**. The Specifications folder is selected initially; the last assessment selection is remembered. Assessment runs only when requested. It does not run when a document is uploaded, a drawing opens, or someone changes a filter.

Results are interactive system specifications, stored alongside existing company/job pipe standards. They are not a generated report filed in Documents. The existing company standards continue to work for legacy takeoff. A drawing selection can choose the applicable job system. Its pipe, fitting, valve and joining requirements constrain the catalog candidates for each measured size before material-list creation.

## Reviewing and using a system

Each result includes source passages with immutable document-version IDs or drawing sheet/revision IDs, page numbers and section headings. Drawing evidence opens the cited sheet revision. PDFs use physical, one-based pages matching the document viewer. Word/text sources may have section citations without page numbers. The extraction copies the source text; the model selects candidate values rather than writing requirements or invented quotations.

Review the applicable size intervals, component scopes and allowed materials. The system retains multiple permitted alternatives; it never silently picks one when several are allowed. Map unresolved alternatives to the actual catalog's material, category and catalog filters. Type, schedule and standards qualifiers stay visible, as do joining methods. A single clear alternative can resolve automatically after review; competing options require a choice. Confirmed rules constrain the existing part matcher, with size and fitting type checks still applied.

Unreviewed rules, unresolved contradictions, overlapping scopes, ambiguous size limits, inaccessible/stale sources and missing catalog mappings block the affected takeoff lines. Requirements for an unused component group do not block otherwise valid lines. Adding manual rules, editing the system name, correcting requirements, choosing alternatives and suppressing extracted rules are supported. An override is user intent, not a new claim made by the assessment.

Reruns merge into the latest saved revision. They preserve manual corrections, user-selected alternatives, manual names and suppressed rule IDs. Changed source evidence requires review again. Systems no longer identified are retained with a review warning. Source deletion/replacement is recoverable by a document manager; a partial-access member cannot overwrite systems derived from restricted documents. Rule splits, radically changed headings or materially rewritten clauses can become new candidates and need review; deletion tombstones identify previously extracted semantic rules, not every future rewording of the same intent.

## Runtime and access

- Migration `0088_job_system_assessments.sql` adds the job-level assessment status table. Rule data extends existing `pipe_system_spec` JSON. Original source files remain in their existing store; private extraction and answer checkpoints are stored separately for resumption.
- Assessment uses hosted Qwen by default, or an organization-owned OpenAI-compatible Chat Completions connection configured under Settings → Assessment AI. There is no Jev call or fallback in this flow. Hosted model identity is checked before sending evidence; the configured model ID is recorded.
- Only the explicit assessment mutation sends selected document and drawing passages, catalog material names, and narrow typed questions to the selected model. PDF/Word text extraction and OCR run locally. No customer document was submitted during development validation.
- Organization membership, dashboard access, job existence, folder ACLs and job-list editing permission are checked. Completion rechecks current access and source fingerprints. Private source titles, status messages and passages are redacted from users without document access.
- Manual saves use optimistic revisions and validate tenant-owned catalog IDs. Assessment commits and saves serialize on the same job lock. Assessment merges the latest row instead of overwriting edits made during processing. Client-provided citations cannot replace the original assessed quote.
- Work runs asynchronously with a bounded in-process queue (four admitted runs). Processing rows persist in PostgreSQL, with ownership tokens and 15-second heartbeats. A recovery dispatcher claims abandoned runs after a 90-second lease. There is no whole-run 15-minute cutoff; extraction batches and provider requests retain three-minute timeouts. Provider batches retry at most twice, retaining completed progress on failure. Source/access changes stop further work and publishing. Final results merge atomically, preserving manual edits.

## Bounds and current limitations

Assessment accepts up to 20 documents and 500 current drawing sheets per request. The picker supports jobs with up to 2,000 stored drawing sheets. Drawing notes, schedules, legends and system labels are extracted from the existing local PDF text index, using the current revision only. Image-only symbols and scanned drawing sheets require manual review; drawing extraction does not run OCR. A legend/system label is a clue, not proof of installed scope or material requirements: drawing-derived systems include an applicability review issue.

For documents, the PDF reader visits all pages in batches of eight, in memory-limited child processes. Scanned pages use local Tesseract OCR with per-page deadlines. Each page is bounded to 100,000 characters, with explicit truncation warnings. Non-PDF text extraction retains its 2.5-million-character limit. OCR, unreadable pages, truncation and unsupported file formats are reported. Searchable PDF, DOCX, TXT and Markdown are supported. Linked Office URLs need an uploaded file. Word pagination is not fabricated.

All relevant passages are visited. Provider requests split at approximately 12,000 question characters or 16 questions and share bounded source context. Large specifications should be split/organized and reviewed carefully; the feature does not claim exhaustive extraction. English is the currently validated language. Unrecognized system names/materials and complex tables can require manual rules. Generic common-system terminology and source headings are used, with no project-specific drawing or equipment tags hardcoded.

Size and material conditions beyond recognized intervals—installation location, differing valve types, conflicting mandatory clauses and methods conditional on material—are preserved as evidence and flagged rather than silently generalized. Catalog mapping initially uses unique exact facet-name/alias matches. It does not invent equivalent materials, guess pressure ratings, or establish engineering compliance. Review the actual project requirements before ordering.

## Validation

- `pnpm exec vitest run src/server/job-systems/analyze.test.ts src/server/job-systems/sources.test.ts` covers size-boundary semantics, alternatives, evidence/page provenance, joining extraction, mixed generic/specific materials, valve scopes, request bounds and source ACL filtering.
- `bash scripts/test-job-systems-db.sh` creates a disposable local PostgreSQL instance. Tests cover tenant/permission checks, persisted output, automatic lease recovery, continuing past the old deadline, concurrent correction preservation, changed-source rejection, hidden-source protection, cross-organization IDs, fabricated citations, optimistic save revisions and document-manager deletion/replacement recovery. It never uses `DATABASE_URL`.
- `RUN_REAL_SYSTEMS_ASSESSMENT=1 pnpm exec tsx scripts/test-job-systems-provider.ts` is an explicit synthetic-only provider smoke test. It generates a PDF and temporary private blob, extracts its text, submits only that fixture to the configured provider, maps returned rules and checks the 2-inch copper / over-2-inch carbon-steel boundary after simulated human approval. The latest run used hosted `Qwen3.8-27B` and produced pipe, fitting, valve and joining rules. This confirms the integration on that synthetic case, not accuracy or completeness on customer specifications.

## Assessment AI connections (2026-10-21)

Company-settings permission is required to view or modify connection settings. Test and save runs a synthetic request before saving. Provider keys never return to the browser and are encrypted with AES-256-GCM and organization-bound authenticated data under `uploads/assessment-ai`. Back up this directory including `.credentials-key`; alternatively supply a stable base64 32-byte `ASSESSMENT_CREDENTIALS_KEY`. Do not rotate or lose this key without migrating credentials.

Hosted configuration is operator-controlled: `ASSESSMENT_QWEN_URL` defaults to `http://127.0.0.1:8082/v1`, and `ASSESSMENT_QWEN_MODEL` to `Qwen3.8-27B`. The local service must advertise that model. Custom connections require public HTTPS on port 443, JSON-mode Chat Completions, and the exact model ID. DNS answers are checked and pinned; redirects/private network endpoints are rejected. Reasoning defaults to omission; low/medium/high are optional and must be supported by the selected model. Provider incompatibilities fail explicitly, never silently switch providers.

Each assessment captures its connection at submission, so settings changes do not retarget queued work. Requests are bounded and responses validated against known criteria. LLM confidence is self-reported, not calibrated: existing conservative candidate coverage and human review remain necessary. Completion or schema validation is not proof of engineering accuracy. This version does not implement unrestricted image understanding or universal component extraction.

## Resumption and operations

Extraction batches and validated model answers are saved atomically under `uploads/assessment-checkpoints/<organization>/<run>/`, with private file permissions. Encrypted provider snapshots live under `uploads/assessment-ai/<organization>/runs/<run>/`. Both stores must be durable and shared by application replicas. They contain project-derived data and should follow the same access and retention policy as document uploads. Roots can be configured with `ASSESSMENT_CHECKPOINT_ROOT` and `ASSESSMENT_STORAGE_ROOT`.

A restart resumes processing runs automatically. Retrying a failed assessment reuses checkpoints if selected source versions and the provider connection match. Completed runs start fresh when reassessed. Changed sources or provider settings create a new run. Ownership checks prevent superseded workers from publishing. Progress shows page ranges and relevant-passage counts; closing the browser does not stop work.

Validation on October 21 read all 575 pages of Alma's combined specification without extraction warnings, then reused those checkpoints in 5 ms. This validates extraction coverage and resumption, not subsequent AI accuracy.

## Super Spec Material (2026-10-24)

Drawings → More → Super Spec Material opens a job-scoped summary. Assess all specifications always reads the accessible current documents under Specifications, including nested folders; it does not reuse a prior custom document/drawing selection. It shares the existing durable assessment, company provider configuration, permission checks and reviewed Systems rules. Opening the tool does not start inference. Folder assessments accept up to 500 documents and fail explicitly beyond that bound; custom Systems selections retain their existing 20-document limit.

The summary currently covers pipe, fittings, valves and joining. It displays source evidence, unresolved issues, stale/failed assessment warnings and catalogue candidates for each alternative. Candidates are filtered by mapped catalogue facets, required text terms, component terms and nominal size limits, with unknown sizes excluded from bounded ranges. Previews consider at most 200 candidates and show ten; this limit is visible. Joining, certification and all other product details still require human review. No catalogue suggestions are automatically approved or ordered.
