# Dev review queue

Newest deployment first. The dev deploy tool writes entries; source preparation is not a deployment. Review batches against the last reviewed build, then advance that baseline. Findings become tasks. A broken journey or a >25% slowdown confirmed twice is escalated to Tim for a rollback decision. Full gates still apply to production promotion.

Current reviewed-build reference remains the prior accepted Phase 0/wizard evidence; the new 15-sample calibration is incomplete. Completed B and C01–C05 are preserved. C06 was interrupted at 2026-11-12T11:14:11Z for the first dev deployment and must be repeated; it is not a passing capture.

<!-- DEV_DEPLOY_ENTRIES -->

## 2026-11-12T11:24:59.093Z — Astra

- Change: Accept short deliveries without requiring a backorder decision; warn when partly received orders still need material; use clearer wrong-item labels and preserve existing receiving decisions.
- Commits: 4284faafff84497dea443e2b5ed8794ef67ddd34, 5ae53190b27b640a0142420c3a82c35152c3e157, 3243df60e34f9c12a246eb0e262ce29c2177a836, 3a777cc0b0d457eb5a6f3cdb252d171df15d749b
- Build: `ce8f5414e212bc7ac0f3ee01ec75d93812b298e96742f50f72a36a24bf4e10e3`; replaced: `9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0`.
- Changed JavaScript gzip bytes: 214148 (review metadata only).
- Flags: worker/shared worker source=true; shared scripts=true; large change=true.
- Attempt record: /home/tim/.openclaw/workspace/kublai/.dev-deploy-attempts/2026-11-12T11-23-19.087Z-3ad1df8b-3326-4b4f-bc5c-224a2f9d7d00.json.
- Review status: waiting. Static payload finding and remaining checks: [review tasks](REVIEW_TASKS.md#receiving-dev-batch-ce8f5414--2026-11-12).


