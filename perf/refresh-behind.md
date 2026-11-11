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
