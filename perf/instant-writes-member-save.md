# Member permission-save feedback

Prepared Phase 1 caller slice for observed `organization.updateOrganizationMember`
(two calls in the recorded inventory, not a new ranking). No permission or access
is granted by local state. The form remains a proposal and the member list retains
server data.

Save sets a synchronous attempt latch and a visible `Saving changes…` state before
dispatch. Draft, discard, access, preset and simulation controls are locked until
the result is reconciled. Offline submission sends nothing; the mutation uses
`networkMode: always`, `retry: false` and no replay queue. A successful response
moves to `Refreshing permissions…`; success notification waits for authoritative
reads. Organization refresh now propagates refetch errors rather than treating a
settled cache invalidation as proof of refreshed permissions.

A refused or uncertain write retains the draft, explains the result and offers
`Refresh permissions`, which issues reads only. Known refusal codes retain the
server's explanation. If the write succeeded but refreshing failed, the notice
says the changes were saved. Recovery never resends the write automatically.
Current management rights still govern editing after refresh.

The detail is keyed by organization, effective user, simulation and selected
member. An unmounted attempt cannot update or notify a replacement view, including
A→B→A. The optional `expectedAccountKey` input rejects a changed authenticated
actor before the existing permission check/transaction; omitted input from old
clients follows the unchanged path. All existing target, executive, self-access,
preset, organization and reporting checks remain. No schema change.

Validation on 2026-11-11:

- 39 tests across `use-member-save`, `MembersSection`, the account guard and
  existing organization invitation cases pass. They cover double dispatch,
  pending/refresh feedback, offline refusal, draft preservation, unknown and
  refused results, accepted-write/read failure, read-only recovery, account
  replacement, late callbacks and existing protected-member/preset behavior.
- New hook/tests/page are lint-clean. Existing MembersSection has one finding
  and organization router has 37, identical by rule/message/count to HEAD before
  this change. No findings added.
- Full repository TypeScript reports 62 unrelated errors; zero in owned paths.
  This is not a clean full-project or canonical-production-build claim.

The tests are mocked UI/router checks, not server performance, real Clerk,
physical-phone, same-frame acceptance, or an offline convergence proof. These
changes are unactivated. A draft is retained in its mounted editor only; this
slice does not add crash-safe persistence, optimistic rights or accepted cache
rows. Switching away before completion leaves subsequent reconciliation to the
existing authoritative reads.
