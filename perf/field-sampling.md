# Field sampling limits

Prepared source now reserves capacity for late Web Vitals and journey marks.
The Phase 0 bootstrap collector could fill its 30-entry queue or 120-sample
document budget with raw EventTiming observations before final INP arrived.
Existing measurements remain observations; missing INP/custom marks must not
be interpreted as fast interactions or zero activity.

`SpeedMetricBuffer` retains the same overall limits, with separate document
budgets: 10 vital samples, 60 journey marks, and 50 diagnostic observations.
A vital or journey mark may replace a lower-priority queued observation when
the 30-entry buffer is full. A failed beacon keeps its batch for another attempt.
Each batch retains one screen/link classification, and the wire format still
contains only the existing allowlisted numeric metrics and coarse tags.

This is bounded diagnostic sampling, not an unbiased census of interactions.
Do not calculate INP from the raw `interaction` samples; use the `inp` metric
from web-vitals. A few INP measurements are only an early signal, not evidence
that a field percentile is stable. Phone viewport tags do not establish that
the device was the reference Google Pixel 9 Pro XL.

The change is prepared source only until a gated release containing it is
activated. It does not retrospectively repair or replace the live bootstrap's
field samples or the frozen Phase 0 lab build.

## Vital context attribution

Final INP/LCP callbacks can arrive after a route or network change. The prepared
collector now looks up their performance-entry start time in a bounded history
of 256 coarse screen/link transitions. No paths, content or identifiers enter
that history or the payload. An entry with missing timing or evicted context is
tagged `other`/`unknown`; it is not guessed to belong to the current screen.
Previously captured screen/link tags describe callback-time context and cannot
be retroactively corrected. This does not change the numeric INP values.
