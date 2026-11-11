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
