# ForemanHQ performance and reliability review — September 30, 2026

Reviewed source at `3e61b74` on `tim-development`. This continues the September 22 performance audit and implementation; previous improvements such as delta responses, shared subscriptions, deferred dialogs and bounded image downloads are already present and should be preserved.

This review changes no application implementation, production data, configuration or deployment. It adds only this report. Existing untracked catalog images were left alone. Code findings concern the current checkout; the running app uses `.next-asset-management-20260925`, so this review does not establish that every source finding is present in that deployed build.

## Observed baseline and limitations

- Local `/api/health`: HTTP 200, approximately 12 ms total; database probe reported 7 ms. This is one local observation, not a mobile page-load benchmark.
- App service active, zero restarts in its current service accounting; approximately 784 MiB current service memory. This does not establish historical uptime or a memory leak.
- Database is local. PostgreSQL estimates: 6,704 part definitions, 89 jobs, 158 material lists, 562 quote items and 1,028 order items. Estimates are not exact business-record counts.
- Nightly database-backup timer is active; the September 30 run reports success.
- `pnpm exec tsc --noEmit --incremental false`: passed.
- Selected existing sync, subscription, photo-cache and upload tests: runner reported 20 passing tests across 10 files.
- Isolated quantity-control checks: three passing characterization tests, including a mounted-save control and an unmount-before-debounce reproduction. A synthetic plus-button test omitted browser focus/blur behavior and is not treated as proof of a real click-path bug.
- Isolated upload checks reproduced an expired session rejecting both resume and replacement, and an orphan global lock blocking another user.
- A service-worker VM check reproduced a successful image download becoming a failed display request when cache storage throws `QuotaExceededError`.
- Browser control was unavailable in this session. No authenticated screen walkthrough, Android profiling, network waterfall, production build or full test suite was run. The inspected user journal returned no entries for the requested 24-hour window, so no production latency percentiles are claimed.

## Findings, in recommended order

### 1. Preserve quantity edits when the row unmounts — high priority, small/medium change

Source: `src/components/materialLists/QuantityControls.tsx:72–97`.

Typing schedules persistence after 650 ms. Unmount cleanup cancels that timer and clears the pending quantity. If navigation or another UI transition unmounts the row before the timer fires and without an input blur, the displayed edit never reaches Replicache. The isolated component reproduction confirms this sequence; it is not a claim that every back-navigation path loses edits.

Persist validated edits locally immediately and debounce only network synchronization, or move the pending-save ownership outside the row. Do not rely exclusively on browser blur. Validate back gestures, view changes, row removal, fast typing and IndexedDB failures.

### 2. Recover abandoned upload reservations and locks — high priority, medium change

Sources: `src/server/rooms/upload-session.ts:68–86,145–170,244–267`; `src/app/api/job-rooms/upload/route.ts:159–184,228–243`.

An expired receiving session cannot accept chunks, cannot be resumed through initialization, and still counts as the user's unfinished upload. Eight abandoned receiving sessions can block admissions globally. `init.lock`, `chunk.lock` and `worker.lock` use exclusive file creation without owner-liveness recovery; a process or power failure can leave them behind. The first three conditions were reproduced on isolated temporary storage.

There is also a state discrepancy: upload GET can report a timed-out processing session as `error` without saving that transition, while retry POST requires the stored status to be `error`. After a crash where the normal exit handler cannot run, that retry can remain stuck at `processing`.

Add safe recovery using worker identity and liveness, durable state transitions, a cancel/restart action and bounded staging cleanup. Never steal a lock merely because it is old while its renderer may still be running. Test restart and power-loss boundaries as well as clean worker exits.

### 3. Make cache writes optional for successful online responses — high priority, small change

Source: `public/sw.js:70–127,137–147,175–191`.

The service worker awaits cache writes before returning downloaded images and static assets. A quota/storage error rejects an otherwise successful image load; the isolated VM reproduction confirmed this. Navigation caching can similarly enter its offline fallback after a successful response if its cache write fails.

Return valid network responses even when caching fails. Catch cache read/write failures separately from network errors, retain background work with `event.waitUntil` where appropriate, and bound cache size. Test full storage, disabled storage, offline fallback and cache-version changes.

### 4. Give room-detection runs unique identities and resource limits — high priority for heavy use, medium/large change

Sources: `src/server/rooms/detect-job.ts:76–99,104–208`; `src/server/rooms/detect-worker-process.ts:10–51`.

A stale job can be replaced, but subsequent worker updates are keyed to floor ID rather than a unique run ID. An old worker that resumes after a replacement can write progress, completion or room results belonging to the replacement run. Heartbeats advance with log messages rather than an independent lease.

The detection launcher also has no global admission limit, memory ceiling or execution deadline comparable to the upload renderer. Different floors can launch simultaneous expensive workers. These are code-path risks, not reproduced production failures.

Introduce a run ID/lease and require it for every state and result commit; cap concurrent detection work and isolate resource usage. Test a stalled old worker completing after a retry, concurrent floors, cancellation and server restart. Preserve confirmed/manual room protections.

### 5. Replace full-table sync fingerprints with transactional revisions — main server performance opportunity, medium/large change

Source: `src/server/replicache/pull.ts:53–104,159–179`.

Delta responses now save network traffic, but every pull still hashes complete rows of six catalog tables or thirteen material-list dependency tables before it can reuse a cached view. Several material-list dependencies are hashed globally, so unrelated organizations can invalidate one another's views. Material-list polling runs every 60 seconds, with extra event/visibility pulls; catalog polling runs every five minutes.

Use organization-scoped revision counters or a change log maintained in the same transaction as writes, including shared-metadata changes and deletes. Preserve direct-SQL change detection through database triggers or an explicit maintenance protocol. Measure unchanged-pull database work and response bytes before/after; do not replace the fingerprint with an incomplete `max(updatedAt)` check.

### 6. Reduce repeated browser work on material lists — medium priority, measure before a broad rewrite

Sources: `src/hooks/use-replicache-jobs.ts:104–189`; `src/components/materialLists/MaterialListSheet.tsx:52`; `src/components/materialLists/SupplierSelector.tsx:107–109`; `src/lib/offline-supplier-parts.ts:21–32`.

The shared workspace subscription avoids duplicate subscriptions, but still scans all jobs, lists and items and rebuilds their derived structures after relevant changes. Every material-table row mounts at once. Each supplier selector reads and parses the entire legacy supplier-parts localStorage envelope on mount/open.

Keep shared subscription benefits while adding list-specific indexed reads or incremental derivation. Parse supplier data once per cache version, or move it into the indexed offline store. Profile large lists before choosing row windowing or pagination; preserve keyboard editing, sorting, search and offline use. No Android frame-time improvement is claimed from this review.

### 7. Bound the wall-graph cache — medium priority, small/medium change

Source: `src/server/rooms/detect-job.ts:230–316`.

Graph entries have a 30-minute freshness check, but the map has no capacity limit and expired entries are not automatically removed. Visiting different floors through click-to-grow can retain old graphs for the lifetime of the HTTP process. Worker-process exit limits retention for standalone detection, but does not solve the long-lived server cache.

Use a capacity/byte-bounded cache, prune expired entries and key pending work by source version as well as floor ID. Validate repeated navigation across many drawings and source replacement during an in-flight build. Current process memory alone is not evidence of a leak.

### 8. Make room-save failures visible and reconcile saved state — medium priority, small/medium change

Source: `src/components/jobs/JobRoomsView.tsx:93,985–988`.

The general `updateRoom` mutation has no shared success/error handler. Trace-save supplies its own invalidation, but the canvas shape-update callback calls the bare mutation. That path lacks consistent cache reconciliation and user-visible failure handling.

Centralize success updates or invalidation, show failed-save state and retain retryable edits. Verify dragging, renaming and saving during a network interruption. This is a source finding; no live room was changed to test it.

### 9. Add page-level recovery for transient failures — medium priority, small/medium change

Sources: `src/trpc/query-client.ts:12–17`; `src/components/app/DeferredFeatures.tsx:30–60`; no `error.tsx` or `global-error.tsx` found under `src/app`.

Global queries disable retries and reconnect refetches. Replicache has its own reconnect handling, but non-Replicache screens rely on individual recovery behavior. Deferred components have Suspense loading UI without a nearby error boundary to recover failed chunk loads.

Add route/feature error boundaries with retry actions and selective reconnect/retry behavior for idempotent reads. Do not automatically retry side-effecting writes without idempotency protection. Test dropped connections and an old open tab following deployment.

### 10. Include uploaded files in recovery planning — medium priority, medium change

Source: `scripts/ops/nightly-db-backup.sh:21–36`; drawing files live under `uploads/job-floor-plans`, and catalog images also live on local disk.

The checked nightly job backs up PostgreSQL and refreshes the Ubicloud copy. It does not include drawing PDFs or catalog image files, so this database backup alone cannot restore a complete app after loss of the machine's disk. The successful timer result verifies execution, not a complete restore. Other independent host backups were not audited.

Add versioned off-site file backups and a restore rehearsal that checks both database references and file contents. Restore a new off-site database snapshot atomically or into a separate database before promoting it; the current `pg_restore --clean` refresh can leave the standby incomplete if interrupted. Preserve historical backups rather than only a current mirror.

### 11. Repair the lint check — medium priority, small change

Source: `package.json` scripts `lint` and `lint:fix`.

Both use `next lint`. Running the current command failed with `Invalid project directory .../kublai/lint`; therefore it is not providing the intended lint gate. Replace it with a compatible direct ESLint invocation using the existing config and make it part of the normal check command/CI. TypeScript passing does not replace lint or failure-path tests.

## Suggested implementation sequence

1. Fix quantity durability, upload recovery and cache-write handling, with regression tests for the reproduced cases.
2. Add detection-run ownership and resource bounds; fix room-save feedback.
3. Measure and optimize unchanged sync, supplier-cache parsing and list derivation. Treat virtualized rows as a measured option, not a prerequisite.
4. Add bounded graph retention, page recovery, complete backup/restore checks and working lint gates.

Each batch should preserve offline edits, deterministic sorting, photos, verification and confirmed room outlines. Use an isolated build directory and staging port for validation; do not build over the live `.next` target. Avoid deleting compatibility APIs simply because the newest UI no longer calls them: older devices can still have queued mutations.
