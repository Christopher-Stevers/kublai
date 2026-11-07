ForemanHQ performance implementation — September 22, 2026

The tested update is deployed at https://foremanhq.stellarator.work. The live `.next` symlink now points to `.next-performance-final-20260922`; `foremenhq.service` restarted at 21:38 Toronto time. Local and public Cloudflare health checks passed, followed by live catalog, order-search, material-list, and Add Part checks.

This completes the changes justified by [the audit](PERFORMANCE_AUDIT_2026-09-22.md). Three older offline mutation endpoints and the isolated PDF workers were deliberately retained for compatibility and recovery. Existing unrelated workspace changes, uploads, and state backups were preserved.

**Measured results**

| Measurement | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Catalog wizard summary body | 1,164,046 bytes | 328,715 bytes | 71.8% smaller; all 5,395 parts represented by 1,406 weighted facet groups |
| Unchanged catalog refresh body | 2,861,566 bytes | 117 bytes | Empty patch for a retained, unchanged view; mutation acknowledgements add bytes where present |
| Unchanged material-list refresh body | 605,333 bytes | 117 bytes | Same protocol, including independent mutation acknowledgements |
| Initial dashboard JavaScript, local files uncompressed | 1,396,165 bytes | 1,105,955 bytes | 20.8% smaller before deferred feature warming |
| Initial catalog JavaScript, local files uncompressed | 1,274,852 bytes | 1,132,935 bytes | 11.1% smaller before deferred feature warming |
| Production TS/TSX/JS source | 59,185 lines in 222 files | 52,237 lines in 208 files | Net reduction of 6,948 lines; test files excluded |
| Obsolete build artifacts removed | — | 10,330,927,385 bytes | 9.62 GiB reclaimed, including the intermediate staging build |

The audit counted terminal newlines as an additional line per file; the source comparison above uses the same `splitlines()` method for both snapshots. These are reductions relative to the source backup taken immediately before implementation, not the repository's older Git base.

Browser profiling used fresh headless Chromium contexts, a 390 × 844 viewport, the configured local agent authentication, and the same machine for old/new production builds. It does not measure a physical Android device or cellular service. Initial JavaScript means the first three seconds after DOM content loaded. Page-observed script transfer fell from 732,558 to 650,962 bytes for the dashboard and from 698,885 to 655,463 for the catalog. Service-worker fetches make later page-only transfer accounting incomplete, so these are not claims about total session traffic.

Optional feature code is deliberately warmed sequentially after startup so it remains usable offline. By eight seconds, observed local JavaScript files totaled 1,486,623 bytes on the dashboard and 1,456,242 on the catalog, including those additional features. Deferral reduces the initial work; it does not eliminate functionality or all subsequent downloads.

Cold offline bootstrap still requires a full dataset. One staged first catalog pull took 36.2 seconds; subsequent unchanged pulls took 1.9–2.6 seconds and transferred 117 bytes. The smaller summary arrived in 3.9 seconds in that run. First bootstrap, database distance, and mobile p95 latency remain limitations; these measurements do not establish a percentage improvement in overall app readiness.

**What changed**

1. The catalog summary groups identical catalog/material/size/category facets and returns their counts. All wizard counters use those weights. Older callers without the grouped flag still receive individual facet rows. A short grace period lets the persisted catalog open before a redundant summary request; the bootstrap no longer repeats Replicache's automatic opening pull. Routes without an immediate catalog consumer start background hydration after startup. Filtered cold-start part search remains available, including its existing large fallback limit, to preserve complete sorting and selection while offline data loads.

2. Both Replicache pull handlers now build an exact, organization-scoped view inside a repeatable-read database transaction. Database-side fingerprints detect direct writes, deletions, and dependent metadata changes. The server diffs the client's exact previous view, even when intermediate replies were missed. Unknown, expired, evicted, or restarted-server views receive a complete replacement. Mutation acknowledgements are read independently on every pull. A database-backed monotonic pull order avoids clock-only cookie ordering. Views are bounded by estimated serialized size (48 MiB), entry count (64), and expiry (30 minutes). Shared dependencies are conservatively fingerprinted; unrelated dependency edits may rebuild a view, but cannot silently omit changes.

   Migration `0036_replicache_pull_order.sql` adds one defaulted column and is registered in the Drizzle journal. It was applied additively before testing/deployment. Request authentication and membership are rechecked for pulls, pushes, and events. The events endpoint now accepts the same configured authentication paths as the rest of the app, eliminating the agent-session fallback-poll discrepancy found during the audit.

3. Add Part, editing, quote/order previews, photo/material-group dialogs, the part stage, and the drawing workspace load through deferred boundaries. A background warmer caches these chunks without mounting their queries. The forced startup overlay and its minimum wait were removed; existing content/loading states display immediately.

4. Photo warming now has four concurrent downloads, URL-level deduplication across messages, and visible-photo priority. Catalog snapshots share one warming callback. Offline requests for a thumbnail that has never been viewed can fall back to its warmed original. Existing Next image sizing remains in use. Four sampled originals were 3.2–17.6 KB and their 64-pixel thumbnails were 844–1,018 bytes; no duplicate image-processing pipeline was added.

5. Removed the 24 unreachable UI/helper/older-room files identified by the audit, plus the startup overlay; removed 31 unused API procedures after checking current callers and available service logs. Cleaned unused imports, props, helpers, and the unused verification-button export while retaining the long-press order picker. Removed five runtime dependencies (`framer-motion`, both browser Stripe packages, `react-day-picker`, and `nodemailer`) and `@types/nodemailer`. Hosted Stripe payments, spreadsheets, QR generation, and active drawing workers remain.

6. Catalog consumers share one Replicache subscription and snapshot per instance. Jobs, list summaries, and list details share a workspace index that handles pending items, quote-linked legacy items, totals, and contributors. Catalog lookup maps are reused across quantity edits. The embedded and dedicated material lists use one sheet and action footer, preserving sorting, photos, quantity controls, suppliers, totals, and the verification-specific notes action.

7. Current order-history clients receive compact searchable item text and load email details when expanded. Item/SKU/quantity searching still covers the complete history, including offline cached summaries; older cached item arrays remain searchable. Only 50 cards render initially, with “Show more orders” for the remainder. Search and filters inspect every order, not just the rendered page. The measured compact response was 104,185 bytes, versus 138,516 in the audit's original response. Older API clients can still request full item arrays.

8. Identical Jev requests share a bounded cache keyed by organization, credential, model, and exact task state/questions/candidates. Concurrent identical calls are coalesced, errors are not cached, and model-alias results expire after five minutes. PDF text extraction is cached by job, source-content hash, page, and extraction version; changed files invalidate it. Room geometry summaries are computed once per row. Provider tests use simulated responses; no paid provider calls or live model-quality claims were made for this work.

9. Deployment retention is implemented in `scripts/prune-next-builds.mjs` (dry run by default; `--apply` deletes validated obsolete build directories). The retained builds are the active performance release, `.next-catalog-first-sort`, and `.next-part-edit-save`. Old production static assets were copied into the new build so already-open clients can still load their hashed files. Temporary staging servers were stopped. Diagnostic evidence, uploads, and state backups were retained.

**Compatibility and reliability decisions**

`materialList.syncMaterialListMutations`, `materialList.applyMaterialListMutationsBatch`, and `job.syncEntityMutations` remain because older devices may still hold unsent offline edits. Their supporting tables were not dropped. API removal was based on both current call sites and the available 14-day log window, not an assumption that every unreferenced procedure was safe to remove.

The live PDF inspection/render/detection workers retain their process, memory, page, and concurrency limits. A 100-page synthetic PDF completed staging and sequential rendering in 89.7 seconds with a reported maximum worker RSS of 211,528 KB. There is no measured alternative proving that a persistent pooled renderer retains the same isolation and recovery behavior, so worker pooling was not introduced.

Broad virtualization and new database indexes were not added without evidence. Shared indexes and limited order-card rendering address the measured repeated work without changing the material-table interaction model.

**Verification and evidence**

- Strict TypeScript, including unused locals/parameters: passed. Isolated production build: passed.
- 165 Vitest tests across 33 files: passed, including semantic sorting, material groups, photo editing, real PDF text extraction, cache invalidation, shared subscriptions, photo-queue behavior, and membership checks.
- 13 Node worker/upload tests: passed, including the 100-page rendering test and resumable-upload limits.
- 16 real-database pull scenarios: passed, including two clients, concurrent pulls, renames, dependent metadata, interrupted replies, duplicate mutation retries, deletions, acknowledgements, and missing-view recovery. Ownership rejection was also checked. The temporary test organization was removed.
- Nine browser workflow checks: passed, including two independent browsers, offline quantity edits, offline reload, offline photos and Add Part search, reconnection, acknowledgement, long-press verification, and the shared embedded sheet. Temporary jobs/lists were removed.
- Seven routes were sampled, and material-list layouts were inspected in portrait and landscape. Post-deployment catalog counts, order item search, the table, and Add Part were checked again. No JavaScript page exceptions were recorded. Fast navigation produced expected `ERR_ABORTED` cancellations of queries, prefetches, and event streams; these are preserved in the diagnostic logs.
- Local and public Cloudflare health checks passed after deployment and cleanup.

Evidence is in `.tmp/performance-implementation/`: `api-after.json`, `bundle-byte-comparison.json`, `routes-after.json`, `source-reduction.json`, `sync-integration.json`, `offline-e2e.json`, `live-verification.json`, `photo-sizes.json`, test/build logs, screenshots, and deployment/pruning records. `source-before.tar.gz` preserves the pre-implementation source for review. The reusable real-database check is `scripts/check-replicache-sync.ts`; it creates and removes its own temporary organization.

To roll back, atomically point `.next` to `.next-catalog-first-sort` and restart the user `foremenhq.service`. The additive database column is backward compatible and does not need removal.
