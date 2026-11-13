# Dev review queue

Newest deployment first. The dev deploy tool writes entries; source preparation is not a deployment. Review batches against the last reviewed build, then advance that baseline. Findings become tasks. A broken journey or a >25% slowdown confirmed twice is escalated to Tim for a rollback decision. Full gates still apply to production promotion.

Current reviewed-build reference remains the prior accepted Phase 0/wizard evidence; the new 15-sample calibration is incomplete. Completed B and C01–C05 are preserved. C06 was interrupted at 2026-11-12T11:14:11Z for the first dev deployment and must be repeated; it is not a passing capture.

<!-- DEV_DEPLOY_ENTRIES -->

## 2026-11-13T02:06:05.197Z — Codex

- Change: Folder cards show descendant drawing previews and total drawings across all nested folders.
- Commits: 29f7922496ef13b79eca5ed762e94725cd273632
- Build: `9123fcedabc46f314497de4509a77c275caf9cff012a58d7a040f2b74b2b6fc9`; replaced: `052baeb5736ee7134bf3dc6e7dea327846ded8762c6e76b8dcec45274001744b`.
- Changed JavaScript gzip bytes: 123726 (review metadata only).
- Flags: worker/shared worker source=false; shared scripts=true; large change=true.
- Attempt record: /home/tim/.openclaw/workspace/kublai/.dev-deploy-attempts/2026-11-13T02-04-34.972Z-5795f4f3-0ba3-4ba4-8038-9fff8ac3fb86.json.
- Review status: waiting.



## 2026-11-13T02:02:15.754Z — Codex

- Change: Remove drawings helper text and center the sort toggle beside the Drawings heading.
- Commits: e93caf642eb6828716a02b5b2a5fa08f23823260
- Build: `052baeb5736ee7134bf3dc6e7dea327846ded8762c6e76b8dcec45274001744b`; replaced: `253c23d1ae19ebff258b29737caf7359feb2681f389be944b77dbf0a8e8a7a0b`.
- Changed JavaScript gzip bytes: 212204 (review metadata only).
- Flags: worker/shared worker source=false; shared scripts=false; large change=true.
- Attempt record: /home/tim/.openclaw/workspace/kublai/.dev-deploy-attempts/2026-11-13T02-00-49.485Z-6063cdb2-bd63-45a3-bfd3-505feb75be0b.json.
- Review status: waiting.



## 2026-11-12T19:51:55.153Z — Codex

- Change: Prevent size taps and held sub-size choices from clicking through category choices in the part wizard.
- Commits: f4fb54d4754c55dfb5bf829d616bf615c06c0552
- Build: `253c23d1ae19ebff258b29737caf7359feb2681f389be944b77dbf0a8e8a7a0b`; replaced: `ce8f5414e212bc7ac0f3ee01ec75d93812b298e96742f50f72a36a24bf4e10e3`.
- Changed JavaScript gzip bytes: 33765 (review metadata only).
- Flags: worker/shared worker source=false; shared scripts=false; large change=false.
- Attempt record: /home/tim/.openclaw/workspace/kublai/.dev-deploy-attempts/2026-11-12T19-50-28.574Z-7b52ed5b-e1b4-463d-b16a-1ff949fd8f35.json.
- Review status: waiting.



## 2026-11-12T11:24:59.093Z — Astra

- Change: Accept short deliveries without requiring a backorder decision; warn when partly received orders still need material; use clearer wrong-item labels and preserve existing receiving decisions.
- Commits: 4284faafff84497dea443e2b5ed8794ef67ddd34, 5ae53190b27b640a0142420c3a82c35152c3e157, 3243df60e34f9c12a246eb0e262ce29c2177a836, 3a777cc0b0d457eb5a6f3cdb252d171df15d749b
- Build: `ce8f5414e212bc7ac0f3ee01ec75d93812b298e96742f50f72a36a24bf4e10e3`; replaced: `9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0`.
- Changed JavaScript gzip bytes: 214148 (review metadata only).
- Flags: worker/shared worker source=true; shared scripts=true; large change=true.
- Attempt record: /home/tim/.openclaw/workspace/kublai/.dev-deploy-attempts/2026-11-12T11-23-19.087Z-3ad1df8b-3326-4b4f-bc5c-224a2f9d7d00.json.
- Review status: waiting. Static payload finding and remaining checks: [review tasks](REVIEW_TASKS.md#receiving-dev-batch-ce8f5414--2026-11-12).


