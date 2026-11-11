# Order preview send feedback slice

Status: 19 focused mocked tests passed with one Vitest worker after the R7 quiet
window released. Scoped ESLint has zero errors and the same two existing
useMemo dependency warnings reproduced on HEAD. No browser, server, canonical
build or real send ran for this slice. It is excluded from frozen R7 and has no
speed/frame claim.

Ownership is limited to `OrdersPreviewSheet.tsx` and its existing email test file.
Tool-room and supplier sends share a synchronous in-flight latch so same-turn
events cannot dispatch a second action. Every Send action is visibly disabled
while that attempt is pending; the active tool request says Sending, while the
supplier action says Saving. The supplier's native mail handoff still happens
inside the original tap before awaiting persistence. Explicit Close, order
release/approval checks, server behavior and confirmations are unchanged.

The mutation explicitly disables retries (the shared client already does so).
Unacknowledged transport outcomes preserve the currently open draft and direct
the user to check existing Orders/Requests before explicitly trying again. The
supplier uncertainty message also says to check the email app: an absent saved
order does not prove an external email was never delivered.
Native-mail invocation is not email delivery confirmation. An acknowledged
mutation followed by failed preview refresh instead reports that the order or
tool request was saved and the preview could not refresh; it does not report a
failed send or open another mail draft. A thrown native handoff does not start
the persistence request. No background retry/offline queue is introduced.

All preview draft inputs are disabled while any send is pending because the
accepted refresh replaces all preview maps, including other orders' drafts.
The email fieldset also disables the supplier-SKU checkbox; draft/note callbacks
check the synchronous latch so a delayed preference effect or programmatic event
cannot mutate those maps behind the disabled UI. Approval-note/check controls
are held for the same pending interval. Close remains available.

The focused tests cover same-turn tool/email dispatch, visible blocking of other
sends, edited email fields/tool notes retained on uncertain outcome, no automatic
replay, acknowledged-save/failed-refresh distinctions, native handoff failure,
explicit Close/reopen while the original attempt remains pending, and disabled
post-dispatch draft controls with guarded maps through an accepted-save/failed-
refresh response. Existing
native mail gesture, permission, approval and saved-order tests remain relevant.
No test sends a message: native links and mutation calls are mocked.

Scope limits: this does not add server idempotency keys, durable drafts or new
cross-view/account lifecycle fencing. Explicit Close retains its existing draft
discard semantics. The server already serializes order rows and refuses fully
ordered rows; that does not replace the client duplicate guard or prove an
unknown transport outcome failed. Broader stale preview callbacks after list or
account navigation remain separate lifecycle work.
