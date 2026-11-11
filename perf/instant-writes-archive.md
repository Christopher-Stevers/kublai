# Drawing removal feedback

Prepared source, not included in immutable R7 or activated. This covers the
observed `drawingsWorkspace.archive` caller in `DrawingWorkspace`, not a new
offline queue or an accepted first-twenty timing gate.

The initiating release immediately shows “Removing <item>…” above the drawing
and changes the selected item's Delete control to a disabled “Removing…”. A
synchronous in-flight guard also refuses repeated viewer/keyboard callbacks
before React has committed the disabled controls. The item and its revision
remain unchanged until the server accepts removal. On refusal the existing
error is shown, the item stays available, and the control becomes usable again.
The transient caption is scoped to the visible account and sheet and suppressed
when workspace data is unavailable. No caption or removal intent is persisted.

Existing permission/revision checks, release gestures, server response patching,
refresh and failure handling are retained. This does not claim new lifecycle
fencing for the existing server reconciliation or turn the archive procedure
into an optimistic completed mutation. No schema, worker or production data
changes are involved.

Verification: all 105 `DrawingWorkspace.test.tsx` tests pass, including deferred
refusal preserving the visible item and duplicate viewer callbacks issuing one
request followed by accepted removal. After the final caption visibility guard,
the three removal tests were rerun. Scoped lint reproduces exactly the same
existing messages as HEAD (workspace 2 errors/5 warnings; test file 50 errors),
ignoring shifted line numbers. No canonical build or physical same-frame result
is claimed for this source-only change.
