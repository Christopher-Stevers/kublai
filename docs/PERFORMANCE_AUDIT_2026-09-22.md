ForemanHQ performance and code-reduction audit — September 22, 2026

Implementation follow-up: [deployed changes, measurements, and verification](PERFORMANCE_IMPLEMENTATION_2026-09-22.md). The audit below records the original baseline.

The largest measured opportunity is to fetch less data and avoid fetching it twice. The clearest source cleanup is 18 apparently unused files containing 2,256 lines. Another 2,120 lines of older room-processing code and 3,073 lines of API procedures warrant a compatibility review before retirement. These are candidates, not a promise that every line can be deleted.

No application implementation, dependencies, configuration, or deployment was changed during this audit. Diagnostic scripts and this report were added. Browser reads performed the app's normal synchronization, including its client-registration bookkeeping; no catalog, list, order, or other business records were intentionally edited.

**Recommended priorities**

| Priority | Improvement | Evidence | Expected benefit |
| --- | --- | --- | --- |
| 1 | Reduce the initial catalog summary and overlapping catalog downloads | Summary is approximately 1.1 MiB; a grouping experiment reduced its facet data by 72% | Faster first catalog/Add Part display; less server/database traffic |
| 1 | Replace repeated full sync with a correct versioned change protocol | Catalog pull: 2.73 MiB; material-list pull: 591 KiB; both start with `clear` | Much smaller refreshes and less database/browser work |
| 1 | Load large dialogs and the drawing workspace when needed | Initial JavaScript transfers range from 598–715 KiB across seven routes | Less initial downloading and JavaScript processing |
| 2 | Bound and deduplicate background photo downloads | Warmer queues up to 1,000 URLs at once; current catalog has 301 distinct image URLs | Prevent background caching from competing with active use |
| 2 | Remove unreachable UI/helpers and unused dependencies | 18 files / 2,256 source lines; five runtime dependency candidates | Smaller maintained codebase, simpler installation and tooling |
| 2 | Consolidate duplicated material-list views and data derivation | Separate sheet implementations and repeated full-catalog scans | Fewer inconsistent fixes and less repeated computation |
| 3 | Simplify the startup animation, old APIs, AI repeat work, and retained builds | Specific findings below | Faster perceived startup and lower maintenance/storage costs |

**What was measured**

Inspected 222 production source files, approximately 59,407 lines, along with the service worker, dependency list, mobile wrapper, database indexes, background-worker entry points, and deployment directories. Traced imports using the TypeScript parser and checked references in source, scripts, tests, and project documentation. Explicitly included workers launched by file paths so they were not falsely classified as unused.

Browser measurements used headless Chromium against the existing production build at `localhost:3000`, a 390 × 844 viewport, fresh browser contexts, and the configured agent authentication mechanism. This emulates the screen size, not an Android phone's CPU or cellular connection. The active build was `.next-catalog-first-sort`.

| Screen | Observed cold JavaScript transfer | Local JavaScript files, uncompressed |
| --- | ---: | ---: |
| Dashboard | 715 KiB | 1,363 KiB |
| Catalog | 683 KiB | 1,245 KiB |
| Suppliers | 610 KiB | 1,003 KiB |
| Material-list detail | 706 KiB | 1,309 KiB |
| Account settings | 604 KiB | 984 KiB |
| Orders | 598 KiB | 970 KiB |
| Quotes | 600 KiB | 971 KiB |

The transfer column includes observed script responses; the uncompressed column counts matching local build files and excludes external scripts. These are baseline loads, not projected savings. Much of the shared framework/authentication code remains necessary.

The initial seven-route sampling window was eight seconds per navigation. Some sync requests exceeded that window, so total page bytes and DOM-ready timings are not treated as complete loading measurements. Follow-up measurements waited for catalog sync to finish. The early reload samples also did not always have a fully populated local database and are not used as a true offline-cache benchmark. JavaScript coverage percentages were discarded because the initial collector did not capture source lengths correctly.

The agent authentication path receives HTTP 401 from the events endpoint, unlike a normal Clerk session. That triggers extra fallback material-list pulls during these tests. Therefore the observed burst of repeated pulls is not evidence that all regular users experience the same burst. The full-payload behavior and configured polling intervals are independently confirmed in source. Public Cloudflare compression, a normal signed-in Android session, p95 timings, and paid AI latency were not measured. Timings below are observations, not service-level guarantees.

**1. Shrink the catalog's initial response and remove duplicate work**

[`getPartWizardSummary`](/home/tim/.openclaw/workspace/kublai/src/server/api/routers/catalogue.ts) at line 695 is described as lightweight, but returns one facet record per active part. The measured organization had 5,395 active parts. The standalone response was 1,164,046 bytes; two requests took 18.3 and 5.6 seconds. Those variable observations should not be averaged into a promised user load time.

[`use-part-wizard.ts`](/home/tim/.openclaw/workspace/kublai/src/components/materialLists/wizard/use-part-wizard.ts) requests this summary while the local catalog is empty. Meanwhile, [`ReplicacheSyncBootstrap.tsx`](/home/tim/.openclaw/workspace/kublai/src/components/offline/ReplicacheSyncBootstrap.tsx) starts a complete catalog pull. The cold client thus requests overlapping data through two paths. Search can also request up to 5,000 full part rows when the local catalog is unavailable.

A read-only data-shape experiment grouped identical combinations of catalog, material, size label, nominal size, unit, and category, retaining a count for each combination:

| Representation | Records | JSON bytes |
| --- | ---: | ---: |
| Current per-part facet array | 5,395 | 1,160,916 |
| Grouped facets with counts | 1,406 | 325,585 |

That is a **72% reduction in facet JSON**, before transport compression. It demonstrates a smaller representation, not an implemented improvement. Existing count calculations must use the retained weights; dropping duplicate facets without their counts would be incorrect.

Recommended change: return counts/grouped facets for the first selection screens; retrieve only the selected part results; coordinate this with a single canonical catalog cache. Keep full offline availability by completing background catalog hydration. Catalog IDs, material groups, fractional sizes, category membership, and the user's include/exclude name groups must continue to behave identically.

**2. Reduce full-snapshot synchronization without reintroducing stale data**

[`catalogue-sync.ts`](/home/tim/.openclaw/workspace/kublai/src/server/replicache/catalogue-sync.ts), lines 94–253, reads the complete active catalog and emits `clear` plus every record. [`material-list-sync.ts`](/home/tim/.openclaw/workspace/kublai/src/server/replicache/material-list-sync.ts), around lines 1141–1514, does the same for jobs, lists, items, suppliers, and related order information. Neither path currently uses the incoming cookie to return only changed records.

Measured response bodies:

- Catalog pull: **2,861,566 bytes**, 5,426 patch operations containing 5,395 parts.
- Material-list pull: **605,333 bytes**, including subsequent pulls with no audit edits.
- In one longer cold browser observation, the catalog selection appeared at 12.7 seconds and the complete catalog pull finished at 21.5 seconds after navigation. These timings include the authentication/testing limitations described above.

[`replicache-material-list.ts`](/home/tim/.openclaw/workspace/kublai/src/lib/replicache-material-list.ts) configures 60-second polling; [`replicache-catalogue.ts`](/home/tim/.openclaw/workspace/kublai/src/lib/replicache-catalogue.ts) configures five-minute polling. The shared dashboard layout starts both engines even for settings and other routes that do not immediately need their complete datasets. SSE, visibility changes, and explicit refresh requests can cause additional pulls.

Database evidence helps identify the right target: reused `SELECT 1` round trips took 122–127 ms. `EXPLAIN ANALYZE` for the complete catalog SELECT reported **27.981 ms** of database execution. Fetching its actual 5,395 rows over the database connection took **18.103 seconds**, producing about 2.06 MiB of JSON when serialized locally. This points to result volume and the database/application communication path as major contributors; it does not establish that every slow endpoint has the same cause. Organization, relationship, and several search indexes already exist.

Recommended sequence: instrument query/transfer/serialization phases; avoid redundant cold-start requests; then implement a real versioned change view with deletions and mutation acknowledgements. A revision-based unchanged response can be an intermediate step only if every relevant write, permission change, and dependent-record update reliably invalidates it. A shared snapshot cache must remain organization-scoped and consistent with authorization and mutation acknowledgements.

The material-list sync code explicitly documents an earlier timestamp-only partial-patch bug. Restoring that shortcut would risk permanently stale devices. Sync optimization needs reconnect, concurrent-edit, deletion, role-change, and interrupted-pull tests. Preserve Replicache's optimistic edits and offline recovery.

**3. Defer feature code until the feature is opened**

[`DashboardClient.tsx`](/home/tim/.openclaw/workspace/kublai/src/app/dashboard/DashboardClient.tsx) directly imports `AddPartDialog`, quote/order previews, editing dialogs, and `JobRoomsView`. The catalog page directly imports editing/photo/material-group dialogs. Their code enters the route dependency graph even when the user is only looking at the first screen.

Useful boundaries include the 1,230-line Add Part dialog, 1,744-line part-details dialog, and 1,150-line drawing workspace. No component-level dynamic imports were found. Begin with these boundaries, render the selected feature on demand, and prefetch on user intent or during idle time. Offline feature chunks must still be cached before an offline-only visit; measure that explicitly.

The spreadsheet library is already dynamically imported in [`catalogue-xlsx.ts`](/home/tim/.openclaw/workspace/kublai/src/lib/catalogue-xlsx.ts). Its approximately 412 KB raw chunk should remain separate. Removing spreadsheet functionality or repeating an optimization already present would not help. Exact bundle savings for the proposed dialog boundaries require a comparison build; source line counts are not byte-saving estimates.

**4. Make background photo caching cooperative**

[`use-replicache-catalogue.ts`](/home/tim/.openclaw/workspace/kublai/src/hooks/use-replicache-catalogue.ts), line 158, initiates warming whenever its catalog snapshot changes. Each hook instance owns this effect. [`public/sw.js`](/home/tim/.openclaw/workspace/kublai/public/sw.js), lines 177–209, takes up to 1,000 unique URLs and starts all their asynchronous cache checks/downloads together. Individual messages deduplicate URLs, but there is no shared queue or in-flight deduplication across messages.

The current catalog contains 301 distinct nonempty photo URLs. A cold cache can therefore create substantial competing work. Add a small bounded queue, deduplicate work across messages, prioritize visible items, and pause or reduce background work when appropriate. Continue eventual warming so offline photos remain available.

Table cells already use Next Image with small `sizes` values. Upload conversion already limits images to 1200 × 1200 WebP. The warmer targets original image URLs, so assess whether offline caching should use the same thumbnail variants as the UI. Measure original-versus-thumbnail bytes before adding another thumbnail pipeline. The image route already provides a long-lived immutable cache header.

**5. Remove apparently unused source and dependencies**

These 18 files have no path from current Next entry points or the identified worker entry points. References within an otherwise unused branch do not make that branch reachable.

| Candidate files | Lines |
| --- | ---: |
| `src/components/materialLists/wizard/steps.tsx` | 516 |
| `src/components/catalogue/CategoryTree.tsx`, `PartCard.tsx`, `PartsTableView.tsx`, `SearchAndFilters.tsx` | 546 |
| `src/components/ui/parts-table.tsx` | 84 |
| `src/components/JobSelector.tsx` | 50 |
| `src/components/materialLists/AddMaterialDialog.tsx` | 103 |
| `src/components/suppliers/PreferredSupplierSelector.tsx` | 168 |
| `src/components/ui/calendar.tsx` | 217 |
| `src/app/_components/PaymentSetup.tsx`, `PaymentSetupWrapper.tsx`, `StripeProvider.tsx` | 234 |
| `src/lib/auth-client-state.ts`, `src/server/auth/config.ts`, `src/server/auth/index.ts` | 81 |
| `src/server/utils/email.ts` | 178 |
| `src/server/utils/rate-limit.ts` | 79 |
| **Total** | **2,256** |

The four catalog filenames in the second row all reside in `src/components/catalogue/`. The two short auth files are unused compatibility/configuration files; current Clerk integration and `auth/permissions.ts` are live and remain necessary.

Dependency candidates:

| Package | Reason |
| --- | --- |
| `framer-motion` | No source imports found |
| `@stripe/react-stripe-js` | Only the unused payment-form branch references it |
| `@stripe/stripe-js` | Only the unused payment-form branch references it |
| `react-day-picker` | Only the unused calendar component references it |
| `nodemailer` | Only the unused email utility references it |

`@types/nodemailer` can accompany the Nodemailer removal. Keep the server-side `stripe` package: the current hosted checkout/payment integration uses it. Keep `xlsx`, QR generation, and the live PDF/geometry dependencies.

Removing these files mainly reduces maintained code, install footprint, and tooling work. Files already unreachable from production routes are generally already excluded from their client bundles, so their removal should not be presented as a large immediate page-speed win. Confirm removal with a clean build and existing relevant tests.

The stricter TypeScript check reported 15 unused-symbol diagnostics. A particularly useful one is the unused `partsByCategory` memo at [`use-part-wizard.ts:273`](/home/tim/.openclaw/workspace/kublai/src/components/materialLists/wizard/use-part-wizard.ts): it performs a filter whose result is never consumed. Several unused props/imports can also be removed. The unused `VerifyOrderButton` export can be removed while retaining the live long-press order-picker dialog in the same file.

**6. Retire older API and room-processing paths cautiously**

The router call-site scan found **34 procedures / 3,073 lines** with no current application references. This is a retirement shortlist: public API reachability, old installed clients, manual integrations, and historical scripts cannot be disproved by an import scan.

The strongest overlap is the old custom synchronization alongside Replicache:

| Procedure | Source line | Procedure lines |
| --- | ---: | ---: |
| `materialList.syncMaterialListMutations` | materialList.ts:1732 | 442 |
| `job.syncEntityMutations` | job.ts:127 | 264 |
| `materialList.applyMaterialListMutationsBatch` | materialList.ts:1586 | 138 |
| `materialList.addItemToMaterialList` | materialList.ts:1035 | 175 |
| `materialList.addItemsToMaterialList` | materialList.ts:1216 | 149 |
| `materialList.updateMaterialListItem` | materialList.ts:1369 | 144 |
| `materialList.listMaterialLists` | materialList.ts:711 | 152 |
| `materialList.createMaterialList` | materialList.ts:336 | 120 |

These router files are under `src/server/api/routers/`. The complete candidate inventory is in the evidence JSON below. Check actual procedure usage and supported client versions before removing endpoints, associated schemas, helpers, or database tables. Removing unused endpoints will simplify the server's maintained implementation; it is not equivalent to reducing every browser download by their source size.

Six further unreachable files under `src/server/rooms/` total **2,120 lines**: `detect-ai.ts` (1,225), `imagine-room-mask.ts` (436), `pdf-room-crop.ts` (107), `detect.ts` (77), `process-pdf.ts` (125), and `snap-walls.ts` (150). They appear to be older approaches. Validate against room-detection fixtures and operational scripts before retiring them.

The active chain uses `detect-worker.ts` → `detect-job.ts` → the floor-graph/PDF geometry pipeline. `upload-worker.ts`, `upload-render-page.ts`, and `sheet-text-worker.ts` are also real entry points invoked through file paths. They are **not** deletion candidates, even though a naive import-only scan would flag them.

**7. Consolidate repeated views and derived data**

The embedded dashboard list and dedicated material-list page contain separate sheet/header/footer/quantity-control implementations. For example, [`DashboardClient.tsx`](/home/tim/.openclaw/workspace/kublai/src/app/dashboard/DashboardClient.tsx) around line 559 uses `MaterialListTableRow`, while [`material-lists/[id]/page.tsx`](../src/app/dashboard/material-lists/[id]/page.tsx) defines another `MaterialListTableView` around line 717. There are also separate navigation/creation flows in the job material-list page.

Extract the common list presentation and actions, keeping route-specific navigation and order-verification behavior explicit. This can reduce duplication and help table, sorting, and mobile fixes reach both entry paths consistently. Splitting a large file without eliminating duplicated behavior would mainly be organizational.

There is repeated data work to address alongside that consolidation:

- Each `useReplicacheCatalogue` instance scans five collections and reconstructs the same catalog snapshot. Share a snapshot/index with granular subscriptions instead of repeating that work per consumer.
- `sortMaterialListItems` rebuilds a lookup for the full catalog whenever its inputs change, including a quantity edit. Cache catalog-derived lookups per catalog revision, while recalculating item-dependent results correctly. Its keyword ranks are already computed once per item outside the comparator; keep that useful design.
- `useReplicacheJobDetail` scans every list and every list item to calculate one job's summaries. Index by job/list or maintain shared aggregates so unrelated edits do not require a full scan for every view.
- Orders returns every sent order and its lines; the observed response was 138,516 bytes for 89 orders. It already batches line retrieval rather than querying once per order. Add pagination or summary/detail loading as history grows, preserving searching and required exports.

These are source-supported optimization opportunities, not quantified CPU savings. Benchmark large lists, search, and repeated quantity edits on Android before adding broad memoization or virtualization. The currently sampled routes do not justify virtualizing every small table.

**8. Remove the forced startup wait**

[`StartupSplash.tsx`](/home/tim/.openclaw/workspace/kublai/src/components/app/StartupSplash.tsx) contains 389 lines and forces a 550 ms minimum hold followed by a 320 ms exit animation after its effect starts. Even an already-ready screen therefore waits approximately 870 ms for the overlay to disappear completely. A missing ready signal uses an eight-second fallback before the exit animation.

Allow the overlay to leave as soon as useful content is ready and simplify its animation/style code. This improves perceived startup without changing data functionality. The exact savings depend on readiness timing; it does not make the underlying database query faster. Preserve any desired branding with a brief nonblocking presentation.

**9. Reuse AI inputs/results; preserve worker isolation**

Reviewed the project-local TypeSafe skill, current provider documentation, the Jev adapter, AI router, and drawing-text worker. AI requests are explicit user actions and are not part of ordinary catalog/list loading. The adapter already batches questions, caps request size/count, applies a timeout, and validates the complete response. Preserve those boundaries. Batching independent questions is also consistent with the current [TypeSafe building guide](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md) and [API contract](https://docs.typesafe.ai/api.md).

Repeated identical AI runs currently rebuild their inputs and call the provider again. Sheet classification also re-extracts PDF text in a new process each time. Consider a bounded organization-scoped cache keyed by source-content hash, extraction version, task/question definitions, candidate set, and model version, with invalidation when any input changes. A model alias such as `jev-latest` needs bounded expiry or a version-aware invalidation strategy. Deduplicate concurrent identical runs. This recommendation comes from the application code; no provider cache behavior is assumed.

The room-review branch calls `summarizeRoomShape(row.shape)` twice per room; calculate it once and reuse it. This is a small direct simplification.

PDF upload starts an inspection process and a separate renderer per page. Reusing a bounded worker for several pages might reduce repeated parsing/startup, but the existing process and memory limits intentionally contain large architectural drawings. Preserve those limits and crash recovery unless a large-PDF benchmark proves an equally reliable alternative. No paid inference or new drawing-processing job was triggered for this audit, so provider quality, latency, and large-PDF speed remain unmeasured.

**10. Prune deployment artifacts separately from application code**

There are **25 retained `.next*` build directories totaling approximately 10.02 GiB**, plus approximately 1.6 GiB in `.tmp`. The active `.next` path is a symlink to `.next-catalog-first-sort`.

A retention policy keeping the active build and an appropriate recent rollback set can reclaim substantial disk and reduce backup/scanning costs. This is storage/operations cleanup, not a direct reduction in pages downloaded by users. Do not delete active builds, user uploads, or state backups as a blanket cleanup. Nothing was deleted during this audit.

The TypeScript file listing included no `.tmp` sources, so there is no evidence that the scratch directory itself is causing TypeScript to process all its contents. Avoid attributing build slowness to directory size alone.

**Implementation and verification order**

1. Record repeatable catalog/list readiness and response-size baselines with a normal signed-in session, including Android and a fully populated offline cache.
2. Ship grouped/minimal catalog metadata and coordinate cold bootstrap; compare payloads and selected-filter counts. Verify the complete catalog → material → size → category → name order, include/exclude groups, and offline Add Part behavior.
3. Defer the large feature components and introduce the photo queue; compare route chunks, input responsiveness, and offline reopen behavior.
4. Remove the 18 unreachable files, unused exports/locals, and five dependency candidates in a focused cleanup. Run TypeScript, a clean isolated build, and existing affected tests.
5. Consolidate duplicate list presentation and shared derived indexes with visual checks for both routes and mobile orientations.
6. Implement versioned sync separately, with explicit multi-client/offline/deletion tests. Retire legacy endpoints after compatibility evidence supports it.

No percentage improvement in overall loading time is promised from this inspection. The 72% figure is a measured reduction in one prototype data representation; source-line and disk reductions describe different kinds of savings.

**Evidence files**

Local diagnostic output is under `.tmp/performance-audit/` and contains no intentional credential exports:

- [Source/import/dependency inventory](/home/tim/.openclaw/workspace/kublai/.tmp/performance-audit/source-graph.json)
- [Router procedure call-site inventory](/home/tim/.openclaw/workspace/kublai/.tmp/performance-audit/router-usage.json)
- [Seven-route browser observations](/home/tim/.openclaw/workspace/kublai/.tmp/performance-audit/runtime.json) and [bundle summary](/home/tim/.openclaw/workspace/kublai/.tmp/performance-audit/bundle-summary.json)
- [Longer catalog sync observation](/home/tim/.openclaw/workspace/kublai/.tmp/performance-audit/settled.json)
- [Direct API observations](/home/tim/.openclaw/workspace/kublai/.tmp/performance-audit/api.json)
- [Database timings, indexes, and query plan](/home/tim/.openclaw/workspace/kublai/.tmp/performance-audit/database.json)
- [Catalog transfer and grouped-facet experiment](/home/tim/.openclaw/workspace/kublai/.tmp/performance-audit/catalog-data-shape.json)
- [Unused-symbol diagnostics](/home/tim/.openclaw/workspace/kublai/.tmp/performance-audit/unused-symbols.log)
- [Retained-build size inventory](/home/tim/.openclaw/workspace/kublai/.tmp/performance-audit/build-disk.json)

The stricter unused-symbol check completed with its 15 reported diagnostics. No implementation change was made, so no replacement production build or deployment was performed.
