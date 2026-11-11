# Live transport consolidation — compatibility stage

This stage replaces the three active browser EventSource families with one account-bound `/api/live` connection per browser document. Separate app windows/iframes remain separate documents; there is no cross-tab leader election. It is a partial first step in SPEED_PLAN section 10, not a claim that polling has been eliminated.

The server multiplexes the existing authorized material, conversation and requested job-chat handlers in process, without internal HTTP requests. Their access assertions, conversation snapshots, durable job-chat event queries and fallback intervals remain authoritative. Old URLs remain usable by old clients. No database schema, worker service, worker bundle or hosting change is needed.

## Existing sources and producer coverage

| Source URL | Producer path | Recovery retained |
| --- | --- | --- |
| `/api/material-lists/events` | Organization material, Replicache and catalogue emitters; existing `foremanhq_change` Postgres LISTEN/NOTIFY bridge | Replicache's existing pull/reconnect behavior; material events missing an organization do not reach the organization stream |
| `/api/material-lists/[id]/events` | Per-list emitter, with membership lookup | Legacy endpoint retained; no current browser consumer found in the source audit |
| `/api/conversations/events` | Conversation post-commit emitter; existing Postgres background hints | Authorized membership/version snapshot every 30 seconds; handles commits from other processes and missed hints |
| `/api/job-chat/events` | Process-local post-commit emitter; durable `job_chat_event` rows | Access assertion and durable event cursor query every 5 seconds; cross-process/old-worker instant delivery is not proven |

`src/server/background/hints.ts` already starts a Postgres LISTEN connection from instrumentation and the worker. Its recognized topics are material, poke, catalogue, conversation and packing-slip work. This patch neither changes that schema nor adds a new worker producer. The single browser transport does not replace these authoritative fallback reads with an unreliable assumption about producer coverage.

## Protocol, auth and lifecycle

- The shared client is bound only by the server-validated Jobs bootstrap account. Subscribing cannot grant identity. Changing account clears cursors and prevents old listeners from receiving the new account's hints.
- Requested job topics are validated and still pass the existing chat access assertions. Cookies and the existing request authentication context reach the original handlers. Any initial child denial closes already-open sources and refuses the combined connection.
- `live` frames contain only a bounded topic, version, optional key/kind and optional Replicache source client-group ID. Chat bodies, conversation member IDs and message contents are stripped. Conversations use a generic invalidation followed by an authorized snapshot.
- SSE event IDs use a process epoch and monotonic transport sequence. A bounded 512-frame ring replays only the authenticated scope and currently requested topics. Restart, an unknown cursor, an evicted gap, or a replay burst over 50 frames produces a reset/catch-up. This is a hint resume buffer, not a durable event log.
- Durable job-chat sequences are tracked separately from the transport cursor and passed to the original chat handler on reopen. The manager preserves these across hidden/visible and reconnect cycles within the account; it does not persist private cursors to disk.
- Every successful connection invokes one catch-up notification per subscriber; consumers refresh their existing authoritative API/Replicache readers. A briefly hidden page resuming an open connection also catches up. Existing query schedulers may coalesce these reads.
- Hint delivery and catch-up callbacks stop immediately in a hidden or retained inactive page. The socket pauses after a 15-second grace period and closes immediately offline. Conversation/job-chat consumers can unsubscribe sooner when hidden. Reconnect uses bounded exponential backoff. A four-minute connection lifetime forces fresh source authentication and membership validation; source chat/conversation polling can revoke sooner.
- Equivalent same-account hints from multiple child-source copies are deduplicated by topic/key/version. Conversations use a hash of the authorized snapshot revision, retained only server-side for deduplication. The bounded broker tests five source copies producing one versioned hint; it does not eliminate their internal snapshot/poll work or establish every producer's durable revision semantics.
- The parent emits one 25-second browser heartbeat, ignoring internal source heartbeat comments. Backpressure and replay are bounded. Cancellation aborts every source and clears readers, subscriptions and timers. Early-abort guards also fix legacy handlers that previously allocated timers after already cleaning up an aborted request.

## Poll inventory and deliberate gaps

The source audit found **29 `refetchInterval:` declarations** on 2026-11-10. None is removed in this stage. This count excludes non-TanStack timers and Replicache's own background scheduling.

| Group | Declarations | Why they remain |
| --- | ---: | --- |
| Notifications/push status | 4 | Not every notification/security producer maps to a proven stream topic |
| Organization/membership | 2 | Role, membership and organization changes require independent authorization freshness |
| Access/financial/estimating permissions | 4 | Permission revocation must not depend on an unproven hint producer |
| Sort preferences | 1 | No complete producer/revision stream contract |
| Conversations | 2 | Existing browser fallback policies remain; durable snapshot reconciliation is retained |
| Job chat | 2 | Cross-process hints are incomplete; durable event/server polling remains |
| Job-home chat counts | 2 | Overview/member/unread changes are not fully represented by a proven topic |
| Models/design | 2 | Existing background workers have no complete notification contract here |
| Drawing workspace/notifications | 2 | Workspace edits and pending processing coverage are not complete |
| Pricing | 1 | Financial correctness and producer coverage remain separate work |
| Timesheets | 1 | No proven topic/version producer for every write |
| Pending rooms/systems/super-* dialogs | 6 | Worker completion/failure paths are not all bridged; their 2-second pending polls remain |

Before removing any row, identify every web/worker producer, verify post-commit notification across independent processes, cover failure/completion/revocation, and prove reconnect catch-up from durable revisions. Then replace that poll and test the domain independently. Do not release the unchanged worker merely to make a coverage claim.

## Verification and remaining gates

```sh
NODE_OPTIONS=--no-experimental-webstorage npx vitest run \
  src/lib/live-client.test.ts src/hooks/use-conversation-events.test.tsx \
  src/server/live/hub.test.ts src/server/live/legacy-cleanup.test.ts \
  src/app/api/live/route.test.ts src/app/api/job-chat/events/route.test.ts
```

Tests exercise one connection for simultaneous material/chat/conversation subscriptions; authenticated scope and cursor separation; hidden/offline/retained-page pause; reconnect backoff and catch-up; content stripping; auth denial; heartbeat; and complete cleanup, including already-aborted requests and repeated opens/cancels of all four old sources. They do not prove real Clerk/production Postgres behavior, under-one-second Site delivery, a ten-minute idle browser with no requests, or half the first-screen request count. Existing background-hint integration tests cover a different transport layer and must not be mistaken for the complete browser-to-worker gate.

No activation is part of this patch. Rollback is reverting this stage's commit; legacy endpoints and all fallback poll policies remain available.

## Candidate poll audit: material sort preferences (held)

`MaterialSortProvider.tsx:33` polls `user.getMaterialSortPreferences` every 60 seconds while online. **Keep this interval.** A preference-only hint would leave an authority dependency uncovered.

The settings themselves have one production writer helper, `saveMaterialSortPreferences` in `src/server/material-sort-preferences.ts`, and one production caller, `user.setMaterialSortPreferences` in `src/server/api/routers/user.ts`. Its web producers are the provider's 400 ms debounced personal/executive edits and the executive `initializeOnly` legacy-preference seed. Personal scope is the effective `ctx.userId`; simulation personal writes use this same route/helper and are audited by simulation middleware. Executive writes require `hasManagingSeat(ctx.user)` and explicitly reject simulation. No worker or separate script producer for these two scopes was found. The table is also used by `server/catalogue/hidden-parts.ts`, but `catalogue-hidden` is a different scope and is excluded by the preference reader's `scope in ('executive', userId)` query.

The query also returns `canEditExecutive = hasManagingSeat(user) && !simulation`. `hasManagingSeat` in `server/auth/permissions.ts:68` depends on role, active subscription ID/status and subscription end time. Organization role/access changes, billing changes and wall-clock subscription expiry can therefore change the query result without any preference-row mutation. Time expiry needs no writer at all. The existing identity expectations (`expectedUserId`, `expectedOrganizationId`), `hasAppAccess`, organization check and server-side executive mutation assertion must remain authoritative. Cached settings or a hint must never grant executive editing.

There is currently no preference publish call or preference live topic. Existing material/Replicache/catalogue/conversation/chat hints do not invalidate this query. The process-local live hub alone cannot cover multiple web processes. The existing PostgreSQL `foremanhq_change` LISTEN/NOTIFY bridge could carry content-free preference identifiers without schema changes or a worker release because the actual settings writers are web-owned. However, its present best-effort publisher swallows errors and listener re-establishment has no dedicated preference resync. A future conversion should consider transactional `pg_notify` with the sole writer (commit and notify together), authoritative catch-up on LISTEN re-establishment/stream epoch reset/reconnect/visible return, and the existing account/simulation audience fences. Executive hints need organization audience; personal hints need effective-user audience across direct/simulation sessions. No settings or capability values belong in the hints.

Before removing this one poll, separately cover `canEditExecutive` through an existing authoritative capability refresh, including access loss and time expiry; do not replace its 60-second authority check with a preference-only event. Tests must include both edit paths, initialize-only seed, personal/executive audience, simulation refusal/target identity, cross-process/transport failure recovery, hidden/offline resume, and capability/expiry changes without preference writes. This audit implements no new transport, removes no interval, and changes none of the other 28 polling declarations.

## Job-home overview hint feasibility (source audit; held)

Do not remove the two job-home `chat.getOverview` intervals yet (`app/jobs/JobsClient.tsx`, `app/jobs/[jobId]/page.tsx`). Neither currently subscribes to a requested job-chat topic. Adding that subscription starts the existing per-document/per-job child handler in `api/job-chat/events/route.ts`: every five seconds it re-reads user and job through `assertChatAccess` (two selects), then queries durable message events (one select). That is approximately 36 select statements/minute before message-triggered polls, versus the current overview query's approximately 10/minute (two authorization selects plus membership, unread-count and max-sequence selects, twice/minute). An overview comparison every 30 seconds would add six more selects/minute if it reused the already-validated access result; comparing every five seconds adds 36. These are source statement counts, not measured database cost. The overview's aggregate costs and the job stream's multiple copies also need measurement. The hub deduplicates emitted hints but does not coalesce child database reconciliation across documents.

The existing authorization result supplies fresh jobName/canModerate; `chatOverview(access)` supplies joined/muted/read-derived unread/latestSequence. Comparing all returned fields at a bounded cadence could cover changes without new schema or worker code, including subscription time expiry through `hasManagingSeat`. Missing producers are concrete: `joinChat`, `markChatRead` and `setChatNotifications` update membership without appending a job-chat event. Message send/delete do append durable events. Authorization denial currently closes the child stream rather than publishing capabilities; any consumer must retain authoritative query catch-up/refusal, never grant permission from a hint. The browser manager already scopes subscriptions to server-validated organization/effective-user/simulation, stops callbacks while inactive, closes offline and catches up on return/reconnect. Those lifecycle guarantees do not create missing overview events.

A new overview invalidation must not reuse a message sequence/version: `live-client.ts` advances its durable job-chat cursor for every `chat` hint. An arbitrary overview comparison counter would corrupt message recovery. A separate explicitly filtered topic or distinct cursor-safe contract would be required in the protocol, source parser, account/job replay audience and client. User-specific overview differences must stay within the full account/simulation scope; no member/read/capability values should enter frames.

Conclusion: there is no clearly beneficial smallest job-home conversion using the current source. It trades two 30-second browser polls for a newly requested five-second server stream poll plus overview reconciliation, while preserving outage polling. Hold this slice. A future change should first share or reduce authorized source reconciliation and show source-bound request/database evidence, or establish complete durable producers plus authoritative capability expiry handling. This is a documented gap, not a new version/permission system or a no-polls claim. No timers or runtime paths were changed by this audit.

### 2026-11-11: realtime material-sort preference updates (poll retained)

Preference writes now enqueue a content-free PostgreSQL notification in the same
transaction as the preference upsert. A failed notification rolls the write back;
an initialize-only conflict emits nothing. The shared web LISTEN bridge routes
personal changes to the effective user (including their separately authenticated
simulation scopes) and executive changes to the organization. `/api/live` carries
only `preferences`/`settings` or `resync` and a broker version, never settings or
editing capabilities. Subscribers opt in; existing child-stream access checks and
full account/simulation scopes remain in force.

The browser coalesces bursts over 100 ms, catches up on connection/visible return,
and fences callbacks after account changes or unsubscribe. A shared LISTEN
initialization/resubscribe epoch triggers authoritative catch-up for notification
gaps. This remains best effort: the **existing 60-second HTTP query is retained**
for preference recovery and editing authority. No browser poll has been removed,
the audited poll count has not decreased, and no server reconciliation poll or
Clerk session-validation loop has been introduced. Existing successful HTTP
responses continue to determine executive editing; stream outage does not revoke
it. Request-bound Clerk identity is not claimed to be fresh session validation.

Validation: focused tests cover audience isolation, broker deduplication,
content-free frames, account cleanup, coalescing, transaction failure and no-op
writes. `bash perf/live/test-preference-transport.sh` creates a disposable Unix
socket PostgreSQL database and verifies delivery to an independent process,
no-op suppression, rollback of both row and notification, and recovery after
deliberately terminating its private LISTEN backend (one expected administrator
termination log). It creates no
production schema, uses no production data and stops/removes its private database.
These checks establish a functional update path, not idle-network, physical-phone
or production performance evidence. Each actual write adds one transactional
`pg_notify`; stream connect/resync can add one coalesced authoritative query in
addition to the unchanged poll. No lower database-cost claim is made.

### 2026-11-11: conditional preference poll replacement (prepared)

The later authority integration supersedes the blanket “poll retained” conclusion
above **only while its full health contract holds**. It reuses fresh successful
HTTP responses from the three already-existing shared `user.getMyRole(undefined)`
observers, adds exact account/app-access/executive metadata, and combines that
with verified preference-topic LISTEN readiness plus authoritative catch-up.
Cached/manual/late responses cannot grant a replacement binding; request-start
order and a60second request-age deadline prevent stale capability revival.

Only MaterialSortProvider's60second interval is conditionally disabled. On
stream/listener loss or stale authority it immediately catches up and restores
that fallback; HTTP editing authority still works during outage. No role poll,
query key, observer, server polling loop or Clerk-validation loop was added.
There is one nonpolling freshness deadline. The29-declaration inventory remains a
historical source inventory: zero unconditional removals, one conditional
suppression,28 other declarations untouched. New readiness frames contain only a
boolean, never settings/capabilities.

See [authority contract, pinned-driver upgrade guard and focused proof](material-sort-authority.md).
This is prepared/tested source with78 focused tests plus one separate private-PG
kill/reconnect integration, not a production idle-request, byte-budget or release
pass. No build, activation, schema migration or worker release was performed.
