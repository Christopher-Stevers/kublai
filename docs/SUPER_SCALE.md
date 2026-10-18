# Super scale

Drawing viewer → More → Super scale. Available online to drawing managers on the current drawing revision. Save pending sheet details first.

1. Open Super scale. Its first prompt starts a fresh Set Scale calibration: mark two points on known grid lines and enter their real distance. Canceling or a failed save does not continue.
2. After the calibration saves, choose two parallel named grids. The preview highlights their actual vectors; the known separation comes from the reference calibration.
3. Find matching drawings in the same job. Review matches and apply the selected results.

The reference distance is transferred, not its sheet-width scale factor. Each target derives its own units per sheet width. Existing calibrations are kept. Normal metadata permissions, revision checks, and activity recording apply to every save. Partial failures are reported per drawing; a changed reference blocks applying the scan. Changing either chosen grid clears prior results.

## Detection and limits

No AI calls. Text positions, circular grid bubbles (including polygon approximations), and axis-aligned vector strokes establish named grid candidates. Collinear CAD dash fragments are joined only across small gaps. Duplicate labels at different positions are excluded. Additional same-axis grid spacing must agree within 2.5% of the reference pair's spacing; disagreement rejects a match. A pair without extra checks is shown unchecked for explicit inspection. Additional checks establish geometric consistency, not building identity; users still inspect the results.

The server worker holds one PDF at a time and cleans parsed pages. Super scale no longer downloads or parses PDFs in the browser, so it cannot evict the visible drawing's cache.

Scans, angled/curved grids, obscured labels, detached grid headers, and vector extraction limits are not automatically calibrated. A page with independently scaled details cannot be assigned multiple scales by this feature. It does not overwrite calibrated sheets, monitor later uploads, or propagate future recalibrations automatically. No drawing scales change until Apply.

## Validation (2026-10-17)

Sampled actual architectural and mechanical PDFs produced named grid candidates. A browser workflow on mechanical pages M-103 and M-105 matched grids 1.01 and 1.13 with 18 additional spacing checks, previewed the source and target, and exercised a simulated save. This is not evidence that every sheet in the project can be calibrated. Production catalogue/drawing data was not altered by these checks.

## Server jobs and caching (2026-10-17)

Reference analysis and matching now run in an isolated Node worker, not in the browser. A PostgreSQL job queue survives closing the dialog or app. One heavy scan runs at a time across server processes; the worker has a 768 MiB JavaScript heap and 15-minute runtime limit. Interrupted jobs retry up to three attempts. Stop cancels the job between pages; Close leaves it running. More → Super scale results reopens the latest job for that user and reference sheet.

PDF pages are grouped by source file so each PDF is opened once per pass. Named-grid results are cached beside immutable source PDFs, keyed by algorithm version, source size/mtime and page. Repeated scans reuse the small result without parsing vectors again. Both extraction paths retain the 250,000-segment cap. Only drawings without a scale are analyzed for transfer.

Completed matching jobs send one private chat message to the initiating account, with a results link and existing chat push delivery. The message and terminal job status commit together, preventing duplicate notices on retries. Reference-only analysis does not notify. The results do not automatically apply scales: the existing review, permissions and revision checks remain in force. Revoked access suppresses delivery and results access.

Deploy the additive queue migration with `pnpm exec tsx scripts/migrate-super-scale.ts` before restarting the app. Instrumentation dispatches queued work every three seconds; no extra system service is required. `bash scripts/test-super-scale-db.sh` runs queue/notification integration checks against temporary PostgreSQL only.
