# Material-sort live refresh recovery

Source prepared during the 20-run unchanged-build calibration. The four new
regression cases are authored, not executed; this is not a test, byte, timing or
release pass. The frozen calibration inputs and active release are unchanged.

The preferences listener previously called its refresh callback before attaching
promise cleanup. A synchronous throw could leave its busy latch set forever. A
rejected refresh was swallowed without clearing the prior healthy state, so a
consumer could continue suppressing fallback polling after catch-up failed.

The callback now enters a promise chain. Both failure forms clear health for the
still-current subscription, and cleanup releases the latch. The existing 100 ms
burst coalescing and one trailing refresh remain. Ownership checks cover the
subscription, account binding, connection epoch and active page before dispatch
and settlement. A late failure from the previous account cannot change the new
account's healthy state. A subsequent successful authoritative read can restore
health; a connected event stream alone cannot.

The source review is complete, including an independent Sol 6.1 review. The
seven-case hook suite includes the three existing tests and four new cases:
rejected-refresh recovery, synchronous-throw recovery, pause before queued
dispatch, and late rejection after an account change. Tests use mocked stream
callbacks and fake timers; they do not establish real server push coverage.

After calibration quiet ends, run this suite with the existing material-sort
authority/provider and live-client suites, then scoped lint/type validation.
Canonical byte and full candidate gates still apply before activation. This
change does not remove any additional polling query, add a server producer,
change authority expiry or introduce a database/worker change.
