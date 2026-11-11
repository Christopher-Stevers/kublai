# Material-sort conditional poll suppression — prepared source

This slice can suppress **one 60-second browser preference-query interval** while its complete replacement contract is healthy. It does not remove the fallback declaration, the three existing shared-role observers, other polling declarations, or all server reconciliation polls. The historical inventory still contains29 declarations/zero unconditional removals;28 other declarations are untouched. No accepted idle-network, startup-byte or physical timing evidence is claimed.

## Authority and lifecycle

`user.getMyRole` retains its existing undefined input/key and30-second permission-provider cadence. Its additive HTTP metadata contains exact `liveAccountScope(org,effectiveUser,simulation)`, app access matching the org/status conditions in `hasAppAccess`, and executive sorting capability `appAccess && hasManagingSeat && !simulation`. Missing org/pending/blocked membership cannot grant sorting access; subscription expiry can remove the capability without a preference write. Existing request-bound authentication is unchanged. This is **not fresh Clerk session validation**, a new session poll, or an SSE capability payload.

`useMaterialSortAuthority` passively subscribes to the existing QueryCache. It creates no role query/observer/request and no new query key. Only an observed actual fetch followed by a nonmanual successful HTTP response for the current account/read-authority/lifecycle may certify capability. Preexisting cached data, hydration and manual cache updates never establish authority for a new binding. Query removal drops its certificate. Full account/simulation/read-authority changes and every online/active transition replace the binding immediately; A→B→A cannot reuse the old certificate. Hidden/offline return stays read-only until a new owned HTTP response, independently of stream status.

Certificates are ordered by **request start**, not response completion. An older preference request cannot overwrite a newer role denial/revocation, and an older error cannot lower the denial fence. Authority age is capped at60seconds from request start; an already60second-old response is rejected rather than renewed at completion. One cancellable freshness-deadline timeout is separate from network cadence: no polling/request loop was added. On stale authority or loss, the fallback is restored and the already-active preference key catches up with `cancelRefetch:false`; it never fetches a role or a new private resource. Pause/unmount/account changes cancel queued catch-up work.

Successful own HTTP preference/role responses still govern editing during stream outage. Ordinary network errors do not revoke a still-current certificate; known denial blocks editing. Cached preference content may remain visible without granting its cached capability. The existing preference debounce/mutation/draft mechanism is preserved, rather than introducing another queue.

## Preference topic health

EventSource connection alone is insufficient. The existing bridge now emits a distinct content-free `preferences-ready` boolean for opted-in streams, reflecting the **actual LISTEN pool**. The client requires topic readiness, transport availability, successful authoritative catch-up and fresh matching role authority before disabling the preference interval. Loss propagates immediately when the driver's close event is observed; resubscribe is ready only after LISTEN establishes again, then existing resync/catch-up repairs the gap. This does not promise detection before the database/network driver detects a failed connection.

The lifecycle adapter intentionally depends on postgres-js **3.4.8** private `listen.sql`. That driver overrides the outer pool's `onclose`, so wrapping the outer pool would not detect listener loss. The adapter verifies installed package version, callable internal pool, distinct pool identity and writable callback shape; otherwise readiness stays false and the60-second fallback remains. It wraps only that callback, forwarding original `this`, arguments, return/throw and automatic reconnect. A global WeakMap avoids stacked wrappers across hot reload, while cleanup removes health subscribers. No new connection, heartbeat query or reconnection timer is introduced. Existing web/worker hint behavior is preserved; **no worker release** was performed.

**Upgrade guard:** a different/unresolvable postgres version or changed shape must keep readiness false. Re-review the installed primary driver source and rerun lifecycle unit tests plus the private PostgreSQL kill/reconnect proof before supporting another version. Do not broaden the version check or substitute outer-pool status merely to remove the fallback.

## Focused evidence and costs

- **78 unique tests across11 files pass** with one Vitest worker. They cover metadata capability/org/subscription/simulation cases; cached/manual/late responses; competing request order; stale/slow reads; A→B→A and read-authority replacement; explicit90second hidden/offline return with fresh HTTP held; query eviction; stream loss; real provider wiring; shared observer count; client/SSE filtering and lifecycle forwarding/fail-closed behavior.
- Actual FinancialVisibility, SystemsAccess and DrawingsAccess providers mounted together still have exactly **three** existing observers of the same role query. In the simulated HTTP test, one30-second step adds one deduplicated shared fetch, with no fourth observer from MaterialSortProvider. This is functional test evidence, not a production request-count measurement.
- `bash perf/live/test-preference-transport.sh` passes its separate private Unix-socket PostgreSQL integration. It confirms transactional cross-process notification/no-op/rollback behavior and actual LISTEN-backend termination followed by availability `[false,true,false,true]` and a new resync epoch. The script stops/removes the private database; only its expected administrator-termination log is allowed. No production table/data/schema is used.
- Client cost: one passive cache subscription, identifier-only readiness frames and at most one authority deadline timeout per provider. HTTP role responses gain account scope and two booleans. Connection/loss/resume/staleness may add coalesced catch-up reads; the retained fallback may run throughout an outage. No lower total DB/byte/CPU cost is asserted without measurement.

The initial adapter fixture incorrectly modeled Sql as a plain object; the private-PG proof exposed the callable-driver mismatch, and the adapter failed closed as intended. The corrected callable shape passes unit and real disconnect proof. A real-provider test also caught a mock server returning allowed preferences after app-access denial; that fixture now refuses consistently, while separate deferred tests prove older successful responses cannot revive access.

No canonical build/typecheck, release, worker rollout or activation. This source depends on preference transport `168502f8`; the runtime slice must be reviewed together. Rollback may restore `refetchInterval:60000` and remove the additive policy/status integration; persisted settings/storage schema is unchanged.

Scoped ESLint reports **zero new findings**: the full owned18-source/test-file batch has17 existing `user.ts` unsafe ORM-typing findings. Repeating the identical batch with an adjacent temporary copy of committed HEAD's user router produced the exact same17 rules/messages/source expressions; the temporary file was removed. All other changed/new files are clean. `git diff --check` passes. Early focused failures included the callable-driver fixture above and missing import/style issues; final78-test run has no unhandled errors. Existing Node module.register deprecation warnings are not functional failures.

## Open executive editor after permission loss — later source slice

The compiled R14 supplemental V5 run observed a concrete UI defect: after a
fresh role response revoked executive permission, the Edit/Close buttons
disappeared but the already-open shared select remained enabled and labelled
“Editing executive sorting.” Separately, a real-QueryClient provider regression
reproduced a worse target error when personal sorting was enabled: changing that
shared editor fell through into a **personal** save. No write was injected into
the compiled denial checkpoint; its observational evidence and this component
reproduction are distinct.

The later fix preserves the selected target. An executive edit without current
executive authority returns without writing; it cannot fall through to personal
settings. The existing shared fieldset becomes disabled and says “Viewing
executive sorting” with a read-only explanation. The separate personal-mode
button remains available under valid personal authority. It explicitly exits
the shared editor, so choosing personal settings still works. No permission,
mutation queue, polling or persistence contract changes.

The new regression fails on the previous source by observing the unintended
personal mutation, then passes with the fix. All 33 tests across the provider,
provider-authority and authority-hook files pass. Scoped lint adds no findings:
the Settings page's existing set-state-in-effect finding matches HEAD exactly;
the provider and changed test are clean. This slice is excluded from frozen R14
and has not yet received a canonical build, compiled UI check or activation.
