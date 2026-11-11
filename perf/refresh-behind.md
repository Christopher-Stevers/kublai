# Reviewed screen refresh behind — verified source

This is a narrow follow-up to Tier 1, not completion of every-screen/offline or latency gates. It does not change the frozen candidate or global five-minute freshness/24-hour retention.

## Explicit inventory

| Mounted screen  | Reads opted in                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Assets overview | `assets.overview`, `holders`, `listAssets` damaged/missing panels                                                            |
| Tool list       | `assets.listTypes`, current-filter `listAssets`, `listStock` only for a selected quantity type                               |
| Tool detail     | `assets.getAsset` for the current ID/tag                                                                                     |
| Locations       | `assets.holders`                                                                                                             |
| Holder detail   | `assets.holdings` for the current holder                                                                                     |
| Asset activity  | `assets.activity`                                                                                                            |
| Job rooms       | Current job `rooms.getJobRooms` overview and `getFloorRooms` only for the selected floor                                     |
| Drawing folders | Current job `drawings.listSets`, `drawingsWorkspace.list` metadata index, and `drawings.getSet` only for the selected folder |

`useTierOneReadOptions` attaches only to these existing reads in authenticated screens. It uses always-on-mount/focus/reconnect refresh, with query eligibility additionally gated by online status, document visibility, and the existing internal-page activity signal. Re-enabling a fresh observer (or selecting another cached query key) explicitly revalidates, because TanStack's default enabled transition only fetches stale data. The explicit transition refresh waits until a guarded microtask after TanStack 5.90.16 applies its observer options. It is cancelled or refused on unmount, key/eligibility changes, account-authority replacement, query eviction/replacement, or inactive/offline dispatch. Requests already in progress are deduplicated, not cancelled/restarted. Cached data is available to paint during the request.

Hidden/suspended Activity panels retain the existing lifecycle: re-subscribing the query on visibility uses the mount policy. No new route, linked sheet, drawing workspace content, image, recognition request or private document is prefetched. Existing neighbour prefetch is unchanged. This does not cancel authorized mutations.

Transient asset refresh errors retain cached content with a status notice instead of replacing the screen with an error. Room floor errors likewise retain an existing floor on ordinary transport failure. Known authority denials remain blocking and reach the existing account/disk denial fence. `rooms.getFloorRooms` is added to authority classification only; it is not added to query persistence.

## Focused verification

Passing deferred tests cover fresh cached paint with a pending request and accepted replacement; fresh offline opening and online revalidation; internal-page pause/resume; transport failure retaining data; and authoritative denial locking the painted screen. A separate cache test checks floor-detail denial without adding floor persistence. Existing drawing/room UI fixtures mock the policy while preserving their deterministic transports; real QueryClient/policy behavior is tested separately.

After explicit quiet-window release, the focused policy/cache/drawing/room run passed **85 tests in four files**, with one Vitest worker. New source/tests were formatted. Scoped ESLint found no new errors: the eleven errors in existing overview/holder/location/room blocks were reproduced exactly by linting their committed HEAD versions (optional-chain1, state-in-effect1, unsafe-assignment7, nullish2); four existing warnings remain. The initial deferred-result assertions were corrected to await TanStack observer notification; the synchronous saved-paint and one-request assertions remain. No full build, physical timing or activation was performed.

## Remaining coverage and limits

- Assets requests, counts, request/count detail, labels, selectors/dialogs, and the tool-room permission helper are not converted here. Asset overview's requests panel retains its existing policy.
- Other job screens, document/model editors, saved searches and engineering settings are not claimed covered. DeliveryCalendarSettings still gates its holiday preview on `isFetching`.
- Query persistence remains its reviewed allowlist. A cold online floor/detail opening whose data exists only in the older custom offline snapshot reader is not newly guaranteed a device-first paint by this policy; migrating those readers needs separate size/latency and authority review.
- SW route refresh still updates CacheStorage without applying a fresh Flight response to the current tree. Next's five-minute route reuse may avoid an RSC request entirely. This patch does not claim to fix that route layer.
- Remote correctness is checked on revisits/resume; this is not realtime producer coverage, no-polls completion, guaranteed 100 ms, physical-phone timing or a release decision.
- Request volume, reference-phone paint and before/after regression evidence remain required before activation. No activation is authorized by this source change.

## Next router memory across account changes — source audit

Next 16.1.1 segment-cache keys use pathname/search/nextUrl, not account identity. The configured dynamic/static route lifetime is 300 seconds. Query-client/provider remounts and SW CacheStorage deletion alone therefore do not prove that Next router memory is cleared.

The actual simulation switch in `SimulationProvider.changeEmployeeSimulation` flushes pending material changes, posts the switch, clears simulation navigation CacheStorage, broadcasts the storage event and uses `window.location.assign` to enter Jobs/Organization. Other tabs reload on that event. Its focus/persisted-pageshow check reads authoritative simulation state and replaces the document on mismatch. Header sign-out first synchronously locks private drawing views through `lockDrawingDownloadsOnSignOut`, then disconnects push and calls the sign-out controller. `HeaderWithClerk` posts application sign-out and invokes Clerk sign-out with a sign-in redirect. The installed Clerk Next provider has its normal auth-state middleware integration enabled: activation invalidates the cookie-backed server-action cache and its post-activation hook calls `router.refresh`. Installed Next's refresh reducer revalidates the segment cache before the full refresh. No application UserSwitcher/UserButton/custom setActive path was found. Organization onboarding rejects an already-associated user rather than replacing their organization. JobsLayout validates server identity/access before rendering; its keyed providers require fresh server props and are not independent router-memory fences.

These are concrete guards for the exposed flows; this audit did not establish a reproducible cross-account Next-memory replay. Existing account-provider, SW and simulation unit tests prove their isolated remount/clear/API behavior, not a real Next+Clerk A→logout→B→back sequence. A BFCache-restored old document is a separate browser proof gap: the simulation pageshow verification is asynchronous, and actual BFCache eligibility and private-content paint before that response have not been measured. Before treating this boundary as browser-proven, exercise sign-out/sign-in, simulation start/end, history back and persisted pageshow in the real application and verify private content remains gated through authoritative validation. No speculative router/BFCache implementation change was made here.

## Workstream 3 navigation coverage review (prepared, unverified)

The registry describes eight journeys: coldstart/openjob/switchjobtabs/openmateriallist/changeqty/receiveline/opensheetpinch/sendchat. These are descriptors, not eight completed gesture conversions. Jobs cards prepare openjob; workspace-option cards prepare their existing screen module and local job data; material-list cards prepare local list/items. Quantity/receipt/chat writes are not initiated by preparation. Drawings preparation loads the existing screen/job metadata only, not unopened private sheet content. Abort signals stop subsequent preparation stages; already-started module imports/local reads are not made cancellable.

Safe priority-bar back/search/overflow controls already opt into fixed press. Accept, Delete and Send remain release actions. Desktop header buttons sit in a horizontally scrolling area and must not be classified as fixed pointerdown controls. Scan-result navigation is an asynchronous result handler, not a press conversion candidate. The registry does not prove coverage of other raw navigation callbacks or latency.

One missed navigation kind is prepared here: Rooms' floor cards now use the existing scroll-mode PressableCard, preserving their selection/reset callback and nested menu behavior. They show pressed feedback on down, activate on release/click, and cancel movement/scroll/pointercancel/outside release. No network preparation or additional private data read is added. Floor selection is a normal Rooms entry path; no per-handler usage measurement establishes its traffic rank. Integration tests are prepared for release, keyboard and cancellation with zero mutations, but are NOT run during the baseline quiet window. Existing primitive proofs are not new application timing evidence. This source slice requires review and focused checks after explicit clearance; no activation or every-screen claim is made.

## Selected-floor local read follow-up (prepared, not verified)

A narrow follow-up now opts only the currently selected Rooms floor into local-first snapshot display. Online reads use `readCurrentRoomFloorSnapshot` for the exact per-floor key, require a matching saved floor ID, and never fall back to the legacy all-floor payload. Offline reads retain the existing legacy recovery. The normal current-floor query remains responsible for background refresh. Overview behavior and query-persistence allowlist are unchanged. Transient refresh errors evaluate the saved detail as available data; terminal denial suppresses it and continues through the existing account-wide denial fence. The wrapper is not a replacement revocation engine.

Real-hook/IndexedDB and deferred real-QueryClient/UI test cases are prepared for empty-memory online revisit, pending refresh, accepted replacement, transport failure versus denial, account/floor isolation and offline-only legacy recovery. They have not run during the current baseline quiet window. This narrows the earlier selected-floor gap only if those checks and authority integration pass; no measured latency, release or every-screen completion is claimed.

### Focused follow-up verification

After explicit quiet release, **38 unique tests in five files passed** with one Vitest worker: Rooms UI/press (24), selected-floor hook/real QueryClient (6), real provider/cache-authority integration (1), shared drawing snapshot hook (4), and room snapshot readers (3). The provider integration holds an actual disk result until after a deferred FORBIDDEN response, checks the private subtree is replaced by the reload gate, releases that late result, then reconnects; neither private content nor the query returns. Only unrelated PDF/text renderer cleanup is stubbed in that integration.

The new hook, both new test files and room snapshot reader pass scoped ESLint. The five findings in existing Rooms UI/trace files reproduce exactly against committed HEAD (two nullish preferences in UI; one nullish preference, one unnecessary assertion and one floating promise in the old test fixture). No new lint error was added. The first command used an unsupported Vitest 4 minWorkers option; subsequent one-worker runs used maxWorkers only. Node 26 web-storage behavior required NODE_OPTIONS=--no-experimental-webstorage for the existing localStorage fixture. A test-isolation issue was corrected by clearing the real store between selected-floor cases, and a menu assertion now respects Radix's temporary aria-hidden outside the open menu. No production behavior change was needed for those fixture failures.

This focused proof supersedes the unexecuted status above for these source slices. It does not prove browser latency, BFCache/account history behavior or deployment. The earlier remaining-coverage statement still applies to overview snapshots and other custom readers; the exact selected floor is now covered by these focused tests.
