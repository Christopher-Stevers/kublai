# Device query save timer — 2026-11-11

The supplementary failed-cell diagnostic recorded 110 timer installations and
110 removals in each candidate material-list operation from the device query
cache subscriber. Its previous debounce cancelled and reinstalled a native
timer for every notification, including observer mounts and options changes.
See `artifacts/failed-cells-diagnostic-2026-11-11-attempt1/` for raw-file hashes,
source mapping, event counts and profiling limitations. These counts establish
unnecessary scheduling, not its uninstrumented latency cost.

The subscriber now records a monotonic deadline and keeps one pending timer.
When that timer wakes, it waits for any remaining quiet period before saving.
This preserves the trailing 300 ms quiet period and existing serialized storage
chain. It does not filter notifications: metadata-only changes can affect
persistence eligibility. Permission-denial handling remains ahead of scheduling
and immediate. Account/generation fencing, explicit flush, opt-in reads and
pending-preview exclusion are unchanged. Stop cancels a defined timer and clears
its handle.

Eight focused tests use actual QueryClient/QueryObserver instances with a fake
monotonic clock. They cover more than 100 observer events with one save timer,
late events extending the quiet period, scheduling after a completed save,
metadata opt-outs and visited-history opt-ins, manual state/reset/removal,
pending-preview ownership, immediate denial, stop/account replacement and the
latest data being encoded after queued storage work. The preview test proves
the pending marker's lifecycle, not server acknowledgement.

Validation: the eight scheduler tests plus the existing device-cache and
instant-query-update suites pass, 39 tests across three files. Scoped ESLint
passes. An independent source review found no correctness blocker. No browser
speed improvement, physical-phone target, deployment gate or activation is
claimed from these unit tests. R19's five failed timing cells remain rejected
until a new exact candidate passes the unchanged full measurement protocol.
