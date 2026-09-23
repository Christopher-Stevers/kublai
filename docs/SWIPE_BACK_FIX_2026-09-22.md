ForemanHQ swipe-back navigation — September 22, 2026

The embedded dashboard changed React state when opening jobs, material lists, and rooms, but never created browser history entries. The header arrow changed that state directly, while Android/browser back left the document. Reopening the dashboard restored its last saved screen, producing the blank/reload loop.

`useJobWorkspaceNavigation` now owns the workspace location, browser history, and saved location. Each screen creates an entry while retaining Next's routing metadata. Both the arrow and browser gestures traverse that stack. Back and forward restore the visited entry, including the root dashboard, instead of reopening a later localStorage location. A saved workspace opened in a new tab gets its parent screens in history; reloads reuse existing entries without duplicating them. The URL stays on `/dashboard`, and navigation requires no network requests.

Changed application files: `src/app/dashboard/DashboardClient.tsx`, `src/hooks/use-job-workspace-navigation.ts`, and its regression test. Redundant per-field navigation state and the separate arrow-only back implementation were removed.

Verification:

- Six navigation regression tests pass, covering mixed arrow/browser back, forward, repeated selection, Strict Mode, reload/remount, saved rooms/lists, and ordinary routes.
- Full working-tree Vitest suite: 175 tests in 35 files pass. Strict TypeScript and both production builds pass.
- The final release passed six Chromium mobile-viewport workflows: complete back/forward stack with no document reload, refresh without duplicate entries, ordinary route returns, rooms, reopening a saved list, and offline back/forward. No JavaScript page errors.
- After deployment, live browser checks confirmed material list → material lists → job options → dashboard, mixing browser back and the arrow, with the same document throughout. Local and public Cloudflare health checks passed.
- This tests the browser history used by the gesture; a physical Android device was not controlled.

Deployment: `.next` points to `.next-swipe-back-final-20260922`; build ID `TayE_NRxSy_KyKgtWDYlp`. The service restarted at 22:10 Toronto time. Prior static assets were retained for already-open clients. Rollback is `.next-performance-final-20260922`, followed by a restart of the user `foremenhq.service`; no database changes were needed.

Separate unpublished Draws work was present in the shared workspace. Its sources were preserved there and excluded only from this release's isolated source copy, `.tmp/swipe-back/release`. The exclusions are the Draws routes/components/helper/router and their additions to Header, TabAccessGate, API root, permissions, and database schema. Navigation sources are identical in that copy and the main workspace. Future builds from the main workspace will include that separate feature unless deliberately scoped.

Evidence, the pre-fix DashboardClient copy, the isolated release source, build/test logs, browser runner/results, and deployment record are in `.tmp/swipe-back/`. The duplicated build-time `.env` was removed from the release source after building.
