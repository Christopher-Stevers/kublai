# Bounded local job-panel retention

`JobActivityPanels` retains the active reviewed panel and at most two previously visited inactive panels with React `Activity`. It never creates an unopened panel. The Jobs workspace keys the host by job; the existing account-keyed application owner unmounts it on account changes.

The reviewed in-place Jobs workspace screens are options, material-list grids and detail, chat, rooms and drawings. Their existing navigation callbacks and history behavior are preserved. Switching back restores their React state while hidden effects, subscriptions and toolbar docks are disconnected. Existing scroll hooks remain responsible for window scroll; no competing scroll manager is added.

The host reads `app-page-activity` and never changes its outer window selection. When the document or retained internal window becomes inactive, it drops all cached inactive panels and hides the active panel with Activity, preserving that active draft while disconnecting its effects. Resume reconnects only the active panel. Event-triggered in-flight writes are not cancelled by the host.

Documents, models and systems are excluded pending lifecycle review. In particular, `DocumentEditor` aborts `pendingSave.current.controller` in its effect cleanup; wrapping it in Activity would abort a save merely because the app became hidden. Its existing cooperative window-pause behavior remains intact. Selecting an excluded workflow drops the reviewed-panel host rather than retaining an unsafe editor.

This is partial job-tab-host coverage: the separate `/jobs/[jobId]/...` route pages and their per-route access/layout gates are unchanged. This patch does not freeze RSC children, bypass those gates, add URL `pushState`, prediction or View Transitions. A full route-level client tab host needs explicit extraction of page content and preserved permission gates. The current in-place workspace already navigates with local state/history helpers.

Existing drawing neighbor preparation is untouched. No new linked-sheet or unopened-sheet preloading is introduced. The separate linked-sheet decision remains pending.

Verification:

```sh
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/components/jobs/JobActivityPanels.test.tsx
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/components/jobs/DrawingWorkspace.test.tsx -t 'retained page is hidden'
```

Focused tests cover retained drafts, effect disconnection/reconnection, three-panel maximum and eviction, dropping hidden panels on inactivity, preserving the outer window's pause, scope-key reset, no unopened panel creation, and completion of an already-started event write after pause. The existing drawing dock test checks hidden portals do not leave controls in another active page's toolbar. These are not real-phone memory, GPU, Safari or eight-journey p95 evidence. No speed gate or activation is claimed.
