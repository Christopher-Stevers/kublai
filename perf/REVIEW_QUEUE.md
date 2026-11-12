# Dev review queue

Newest deployment first. The dev deploy tool writes entries; source preparation is not a deployment. Review batches against the last reviewed build, then advance that baseline. Findings become tasks. A broken journey or a >25% slowdown confirmed twice is escalated to Tim for a rollback decision. Full gates still apply to production promotion.

Current reviewed-build reference remains the prior accepted Phase 0/wizard evidence; the new 15-sample calibration is incomplete. Completed B and C01–C05 are preserved. C06 was interrupted at 2026-11-12T11:14:11Z for the first dev deployment and must be repeated; it is not a passing capture.

<!-- DEV_DEPLOY_ENTRIES -->
