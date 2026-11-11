# Unexecuted diagnostic method revision v2

Source-only follow-up authorized after both zero-capture failures. **Not executed, syntax-tested, profiled or validated in a browser. No third attempt.**

This revision writes each guard rejection immediately to top-level `guardRejections`, before request abort, so preparation failures retain metadata. Only method, a sanitized fixed endpoint/procedure pathname and reason are recorded. URL queries, bodies, cookies, external origins and arbitrary pathname shapes are omitted. The guard itself is unchanged; no additional request is allowed.

Executed attempt1/attempt2 method copies and hashes remain unchanged in their respective archives. This copy matches the prepared `perf/material-list-cpu-diagnostic.mjs`, protocol v2. It is a future diagnostic candidate, not captured evidence.
