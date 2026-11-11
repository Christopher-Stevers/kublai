# Immediate drawing metadata writes — audit and prepared proof

This is a scoped continuation of the first-20-write review. It adds **two reversible actions**, not completion of the twenty-action step. Source is verified by the focused tests below; activation and phone/app timing evidence are separate.

The observed counts below come from `observed-trpc-usage.json`'s seven-day server journal inventory. They may include QA and are not a complete census or a ranking of existing Replicache/queued edits.

| Procedure                        | Observed calls | Audit decision                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | -------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drawingsWorkspace.save`         |             67 | Preserve `useDrawingQueuedEdits` in the workspace and destination picker. Eligible private markup already previews through the durable drawing queue; direct markup also has an existing optimistic overlay. Shared/nonqueueable kinds have separate authority/conflict requirements. The journal does not partition these callers, so do not claim all 67 were already instant. |
| `drawingsWorkspace.openDocument` |             48 | Do not fabricate successful sheets. The server authorizes and creates/reuses backing drawing-page records and stable IDs. Previously opened document sheets can already paint from `useDrawingSnapshot`; an uncached document needs a real server result.                                                                                                                        |
| `drawingsWorkspace.setScale`     |              2 | Excluded here. This shared engineering scale changes measurements for the job and returns authoritative metadata/revision. A local “saved” scale or fabricated revision is not an acceptable substitute. Pending calibration feedback is separate from completion.                                                                                                               |
| `drawings.createSet`             |              2 | Excluded here. The server generates the real folder ID, and the current caller opens it after acknowledgement. A safe temporary-folder design needs disabled dependent actions and ID reconciliation, plus review of the separate bulk-revision caller. No temporary ID or successful folder is invented in this patch.                                                          |
| `drawings.moveSet`               |              2 | Converted for the existing JobDrawingsView caller. Parent location changes in the initiating cache edit; the picker closes immediately, but success is announced only after server acknowledgement. A refusal restores the owned previous value; newer authority wins.                                                                                                           |
| `drawings.renameSheet`           |              1 | Converted for the existing JobDrawingsView caller. The open folder's sheet-name cache changes in the initiating call; refusal rolls it back unless a newer authoritative value has replaced it. Existing auto-sheet-number display formatting remains unchanged.                                                                                                                 |
| `user.finishTutorial`            |              2 | Already immediate locally: the gate stores pending progress per user, closes practice, and opens Jobs before serialized token-fenced synchronization. Do not replace this existing domain workflow with a second queue or remove its offline progress semantics. Not counted as a new conversion.                                                                                |
| `chat.join`                      |              1 | Excluded. `chatProcedure` and `joinChat` assert access/membership. Never optimistically claim the person has joined or expose history/composer permissions before server authority. Existing joining feedback can be improved without inventing successful membership.                                                                                                           |

## Change and boundaries

`useInstantDrawingMetadata` uses the existing `useInstantMutation` and typed `beginInstantQueryUpdate`. It edits only `drawings.listSets` parent IDs or `drawings.getSet` sheet names. Download versions, asset URLs, capability flags, workspace revisions and the drawing entity queue are untouched. The same client move-target helper used by the server rejects a known cycle before sending; server authorization and the transaction remain authoritative.

An already-authorized account snapshot displayed by the folder may seed an empty live-query cache before the preview. In-flight reads are cancelled before that seed so their revert cannot erase it. Invalid/missing targets fail preparation instead of sending an invented action. The request payload contains only the original server input, never the fallback snapshot.

The existing short-lived per-query lock rejects overlap; it is not an offline queue. Offline edits fail without an optimistic cache write or a reconnect replay. Query-instance/value ownership prevents late failure/acceptance from overwriting a newer server refresh or restoring a cleared account cache. Other unrelated query keys remain editable.

A pending metadata preview must not leak into the drawing snapshot store. `useDrawingSnapshot` accepts a settled-value guard, and explicit folder/sheet download metadata writes use that guard too. It requires a current nonpending cache owner and structural agreement with the candidate; pending, removed and superseded values are refused. Query-cache marker subscriptions recheck persistence after settlement even if the accepted value keeps the same reference, or a refused overlapping action is now the mutation observer's latest result. This changes no file-download or durable-edit engine.

A structural comparison is needed because `fetchQuery` may return a fresh accepted object while the cache retains an equal object. The common live-query case takes the equal-reference path. Snapshot guards do not authorize reading new data or manufacture permissions.

The separate live-transport review also found a simulation boundary omission. Server replay/deduplication scopes and the server-validated client binding now use the same organization/user/simulation key. Simulation hints remain content-free and source authorization still applies, but direct employee and actor-simulation cursors must not share a scope.

## Focused verification

After explicit release of the measurement quiet window, the following focused tests passed (Vitest workers limited to one):

```sh
NODE_OPTIONS=--no-experimental-webstorage npx vitest run --maxWorkers=1 \
  src/hooks/use-instant-drawing-metadata.test.tsx \
  src/components/jobs/useDrawingSnapshot.test.tsx \
  src/components/jobs/JobDrawingsView.test.tsx
NODE_OPTIONS=--no-experimental-webstorage npx vitest run --maxWorkers=1 \
  src/app/api/live/route.test.ts src/lib/live-client.test.ts
```

Passing cases cover same-call cache changes, observed name updates before acknowledgement, delayed success confirmation, permission rollback, known-cycle rejection without a request, accepted local snapshot seeding, authoritative refresh/account wipes, overlapping edits, offline rejection/no replay, and refusal to persist a preview before acceptance. The existing drawing view fixture retains its deterministic transport; the new hook tests use a real QueryClient and deferred requests for cache/rollback proof. The simulation regression tests check direct-session hints are not replayed into the same employee's simulated session.

The final combined metadata/live/receipt/JobsClient-tools run passed **101 tests in 10 files**. ESLint on the twelve owned production paths returned zero errors and three preexisting JobDrawingsView warnings (unused tileBase and read/prefetch effect dependencies). A source-scoped TypeScript check still fails on repository-wide existing test matcher/type errors; it reported no errors in the changed production paths or the new hook tests. No first-frame, Pixel p95, worker convergence or production behavior is inferred from unit tests.

## Remaining gaps

- These are two procedure/caller conversions. The other reviewed entries above are not silently counted as completed.
- Metadata seen only through a saved account snapshot remains subject to the current sign-in/access gates. This does not move authentication behind private paint.
- Rename updates the open folder's name list immediately; workspace/index aliases refresh authoritatively after settlement. It does not optimistically rewrite the queued drawing workspace.
- New folder IDs, shared scale semantics, recognition output, membership and permission changes still require separate designs/review.
- Rejected drawing metadata does not enter a new durable queue. A connection loss can leave an accepted server edit whose response was lost; authoritative invalidation resolves that uncertainty without retrying the write.
- Real app/phone timing, full first-20 coverage and the plan's release gates remain open. No activation is included.
