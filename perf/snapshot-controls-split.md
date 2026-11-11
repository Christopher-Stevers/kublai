# Snapshot controls split — prepared and tested

Excluded from frozen R17 and its timing method. This is a later source slice;
no canonical build, analyzer, browser, database or activation was performed.
Focused component and isolated type checks are recorded below.

Existing canonical R17 evidence reports 478,165 shared gzip bytes. Its recorded
client stats attribute 39,692 pre-minification estimated bytes to SnapshotProvider
in jobs-layout dependency chunk 7117, with 8,850 for snapshot-capture. These are
compiler estimates, not additive compressed savings or network measurements.

The bounded split defers only the share/screen/error Dialog and saved-edit
banner presentation into SnapshotControls. Selection overlay, focus/Tab handling,
SavedSnapshotPicker, capture initiation, controller hooks, context, drafts,
pending send identity, URL/route behavior and uploads stay in the provider.
Deferring the selection overlay would change an existing phase-driven focus
effect; it is deliberately excluded. Recipient presentation keeps its existing
separate lazy/error boundary. There is no new provider or speculative data read.

The new import facade mounts only for the relevant screen/share/error/edit
presentation. Its loading/rejected-import state keeps Close available (subject
to the existing busy lock), and Retry restarts only that import. It does not
clear parent capture/message state. Loaded component identity remains stable on
ordinary provider rerenders; late import completion after closing is ignored.
Capture screen still calls the eager controller callback directly in the click
stack; neither getDisplayMedia nor captureSharedScreen is moved behind an await.

Nineteen tests pass across the existing SnapshotProvider suite and five new
loading cases. The new cases also passed independently after fixing fixture
module-cache assumptions. Coverage includes no idle import, Close before delayed
load, synchronous capture-handler ordering, rejected import Retry, retained
capture/parent/caption/local state and actual presentation after provider unmount
or keyed replacement. Existing fullscreen, cancellation, send identity and
explicit capture regressions remain asserted. A fixture initially used the wrong
browser route, and two subsequent mock-isolation failure logs remain at
`/tmp/snapshot-controls-final-tests.log` and
`/tmp/snapshot-controls-isolation-tests.log`; none are performance evidence.
Actual native permission behavior remains a separate validation.

Scoped ESLint has no errors: the same two existing image warnings are now split
between Provider and Controls. Full no-emit checks used an isolated copy of exact
R17 source/config/generated route types, then the exact two runtime files and new
test overlay. Both have zero production diagnostics; the owned paths have none.
The new test explicitly imports DOM matcher types, reducing test-only diagnostics
from 1,975 to 26, with all 26 in the baseline subset. This is not a globally clean
repository typecheck. Completed proof logs are
`/tmp/snapshot-types-baseline.log` and `/tmp/snapshot-types-dom-overlay.log`;
interrupted launches outside that isolation were excluded.

The only intended UI differences are the optional presentation load/failure state
and its immediate Close/import Retry controls. Selection focus/Tab handling and
all capture/controller hooks are unchanged. The saved-query error object is
passed intact, so even an empty error message still disables capture as before.

The next canonical byte criterion is a strict reduction of formal shared gzip
and removal of the new controls module from the rooted jobs-layout startup
closure, while preserving screen/deploy ratchets and the changed-script budget.
No numerical saving or approach to the 120 KB target is claimed from source.
