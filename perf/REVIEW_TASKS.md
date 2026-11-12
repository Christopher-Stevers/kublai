# Dev review tasks

Findings do not undo dev deployments. Production promotion requires the full gate and no open serious finding.

## Receiving dev batch ce8f5414 — 2026-11-12

- **DEV-20261112-01 — update payload (open, minor).** The first receiving dev release changes 19 of 255 scripts, 214,148 gzip bytes against the previous live wizard build. The typical-edit target remains strictly below 100,000 bytes. Inspect copied shared component dependencies and reduce update churn; do not redefine the budget. This is a post-deploy finding, not a dev rollback. Evidence: `artifacts/receiving-dev-2026-11-12/deployment.json`.
- **DEV-20261112-02 — warning coverage (open, minor, source finding).** `orderStillWaiting` shows the triangle after at least one positive net received quantity. An accepted zero-quantity first delivery, or a replacement return that takes all received quantities back to zero, can still leave material due without that triangle. Add a reliable receiving-started signal using existing data if possible, then test both cases. Do not infer delivery completion from zero quantities or change receipt balances.
- **DEV-20261112-03 — batch measurements (waiting).** Resume the unchanged-build calibration with all completed captures intact and repeat its interrupted C06. Then measure the deployed receiving batch against the last reviewed build using the existing journeys and byte budgets. Dev deploys preempt the measurement process. A broken journey or a >25% slowdown confirmed on a second run goes to Tim for a rollback decision; no automatic performance rollback.
