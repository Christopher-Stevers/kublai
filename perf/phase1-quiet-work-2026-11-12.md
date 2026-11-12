# Phase 1 work prepared during calibration

Tim requested independent work while the unchanged-build timing batch runs.
Source edits and reviews proceed in the development checkout. Builds, browser
tests, unit suites, lint, type checking and database work wait until that timing
window closes. No new slice below is tested or live yet. Each remains separate
from the frozen method, source, baseline and control captures.

| Slice | Concrete improvement | Evidence still needed |
| --- | --- | --- |
| Model workspace | Keep cached workspace and model selection through temporary refresh errors; refresh revisits behind; hide terminal denials and explain offline cache misses. | Eight authored focused cases, existing model regressions, scoped lint/types, canonical bytes and candidate matrix. |
| Timesheet period | Use an exact person/date cache key, refresh behind and hide denied or mismatched saved data. Preserve existing authoritative money/review actions. | Fifteen authored read cases plus existing control/mutation suite, scoped lint/types, canonical bytes and candidate matrix. |
| Preferences live refresh | Recover fallback polling and release the busy latch after thrown or rejected refreshes; ignore stale settlements. | Seven-case suite including four new regressions, existing authority/provider/stream tests, scoped lint/types, canonical bytes and candidate matrix. |
| Notification ownership proposal | Keep the reviewed ownership function within the existing module to investigate the rejected candidate's chunk-name propagation. | Pinned actual-inline/owner unit proof, canonical small-change and byte checks. Shared/heavy non-growth remains unresolved; reject if any limit fails. |

Reviewed source commits: models `0bc8726b`, timesheets `8dc746c7`, and preferences
recovery `b3445034`. Both read slices and recovery received independent source
review. The notification test preparer's three local imports are explicitly
rewritten only in disposable test input; its production patch stays unchanged.
No prepared test has been run during this work.

## Remaining polling coverage

Source review does not justify removing these timers yet:

- Jobs' chat overview has best-effort own-actor join/read/mute hints, but its
  passive invalidation observer does not subscribe to every job's message stream.
  Job name and permission changes also need coverage. Connection status alone
  does not prove producer readiness or catch-up. Retain its fallback until those
  paths and lost-event recovery are implemented and tested.
- Timesheet context carries roles and settings. Its current hints invalidate
  data but do not replace authoritative context rechecks. Keep the context poll.
- Models' 15-second interval covers processing and team changes without a proven
  complete event producer. Keep it while improving cached paint.
- Material-sort preferences already suppress their interval only with both a
  fresh authority certificate and successful topic catch-up. The recovery fix
  repairs the failure path; it does not expand suppression.

Raw-navigation and shared-provider regression guards already exist and run in
the canonical build/lint chain. Do not add duplicate guards or declare the
one-stream/no-polls goal complete from an open SSE connection.

## Validation order after quiet ends

1. Run the focused source suites once, retaining failures; fix concrete failures
   and rerun affected checks. Validate relevant existing mutations and authority
   behavior before considering any speed claim.
2. Prepare each accepted slice from a clean, pinned source. Keep unrelated work
   out of the candidate. Use the existing canonical build recipe and unchanged
   shared, heavy-screen and deploy byte limits.
3. Discard any byte-failing candidate before spending a full timing matrix on it.
   The one-file notification proposal is an experiment, not an expected pass.
4. Require completed unchanged-build calibration, the source-matched independent
   reference evidence and the full candidate matrix before activation. Apply the
   approved single-confirmation rule prospectively, never to archived failures.

No new permission is required for these already-authorized checks. Production
schema changes and a receiving worker release remain separate later decisions.
