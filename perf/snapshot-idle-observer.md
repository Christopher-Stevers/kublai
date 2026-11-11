# Snapshot portal observer lifecycle

The shared SnapshotProvider previously observed every body subtree change even
with Snapshot closed. Each callback searched for a fullscreen drawing and tried
to update the portal host. This behavior existed before Phase 0; it is not an
identified cause of the later navigation regressions.

The observer and fullscreen listener now exist only while snapshot controls are
open or a saved snapshot is being edited. A layout effect resolves the current
host before active controls paint. Closing disconnects them; reopening checks
the host again, including drawings opened while Snapshot was idle. Source/page
registries, synchronous capture initiation, screen-capture permission, private
capture data, sharing and child component identity are unchanged.

Fourteen existing/new SnapshotProvider tests pass, including idle DOM updates,
close/reopen in fullscreen, active host removal, delayed capture cancellation,
saved snapshot editing, and retained captions during optional-panel loading.
Scoped ESLint reports zero errors and the same two existing inline-image
warnings. This is prepared source; no CPU timing, script-size saving, physical
device or release-gate result follows from the tests. It is separate from the
FileComparison lazy boundary and from frozen R11.
