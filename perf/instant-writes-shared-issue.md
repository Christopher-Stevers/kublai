# Existing shared-issue save — bounded source slice

This covers only editing an existing own published issue through
`DrawingWorkspace`. It does not extend to new issues, publishing private issues,
other authors, markup, saved views, versions, reviews or transmittals. Private
issue/markup queues and name-only saved-view transactions retain their existing
paths. No second sync engine, queue, fabricated row, timestamp or revision is
introduced. Existing Saving feedback remains pending until a real ACK.

A synchronous per-entity latch guards duplicate submissions. Direct transport
checks browser connectivity and current document/read authority again before
dispatch, so there is no TanStack paused replay or automatic retry. The additive
optional save-router expectedAccountKey guard compares the full live
organization/effective-user/simulation scope before the existing service, then
strips itself. Legacy inputs and the shared drawing-save schema are unchanged;
the service still owns permission, lock, normalization and revision decisions.

A validated real ACK reconciles only an existing query entity. A newer cached
entity revision wins. The owned editor nevertheless finishes once for a confirmed
write, so newer data is not an invitation to resend an already accepted save.
Read invalidation is best effort and does not hold ACK completion or convert a
confirmed write to a failed draft. Same-account reconciliation survives view
removal; actor/read-authority fences prevent it through a replacement account.
View/lifecycle fences separately protect form, selection and error callbacks.

Known refusals retain the form/draft. An unknown outcome keeps the draft, blocks
another write for that entity and hides Save as new private copy. Check latest
issue performs a bounded read, never a write retry; after checking, the user must
close/reopen the editor to review current data before another save. The recovery
request has a synchronous account/view/entity latch, a 15-second abort deadline,
and cleanup on view/account/unmount. Old read completion cannot unlock a newer
request or write error text into a replacement view. Recovery updates only the
selected issue, preserving newer revisions and unrelated records. This recovery
intent is component-local, not a durable cross-reload workflow.

Verification: 131 tests pass across the new hook, save-router actor guard and
existing/extended Workspace integration suite with one Vitest worker. Tests cover
real pending/ACK handoff without a refresh wait, uncertain draft and copy guard,
per-entity duplicate/offline dispatch, newer cache versus ACK completion, actor,
read-authority, view and unmount fences, read-only recovery/reopen, simultaneous
recovery calls and old-versus-new read completion. Router tests cover actual
service-result passthrough, guard omission, mismatched user/org/simulation before
service/DB work, and existing permission refusal. Scoped lint has no added
findings: the same 52 existing errors and five warnings as HEAD by file, rule and
message. New hook/tests/router guard tests are clean.

No canonical build, activation, physical timing, full first20 acceptance,
multi-client convergence, schema or worker release is claimed. The mixed
`drawingsWorkspace.save` procedure remains partial. Rollback is this exact
source slice; the optional router field is backward compatible.

## Follow-up production type boundaries

The failed R15 compile found the nullable caller boundary; `9cbe46d7` normalizes
absent data to undefined without changing guards (122 impacted tests passed).
R16 then found an optional workspace-revision comparison in recovery. Source
inspection established that this value is an opaque MD5 content token, not an
ordered counter. Recovery now compares only numeric per-entity revisions. If
the target is absent it preserves the cached row and uncertain-outcome block,
explains that a full workspace refresh is needed, and leaves removal to existing
authoritative query reconciliation. Missing/default/hash ordering never
supplies deletion authority. Five deferred cases cover absent tokens on either
side and differing hashes in both lexical directions; 127 impacted hook and
Workspace tests pass, and scoped hook lint is clean. Failed canonical snapshots
remain unchanged. Deployment's full no-emit check of isolated exact R16 plus the
correction reports zero production diagnostics. The complete-input comparison
has 1,975 inherited test-only diagnostics on R14, the same 1,975 on corrected
source, and exactly two additional production diagnostics on unchanged R16.
Neither new owned hook nor router guard test introduces a diagnostic. This
collects all production errors before the next canonical build; it does not
claim a globally clean repository typecheck or a successful canonical release.
