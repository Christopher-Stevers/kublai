# R20 exact timer-only canonical proof

R20 is exact frozen R19 plus `ServiceWorkerRegistration.tsx` timer handling from `fff75a2a` and **only the selected runtime diff** of `device-query-cache.ts` from `2e32a462`. The selected cache commit's parent contains receiving changes absent from R19; those budget/authority/404 additions were explicitly excluded rather than copying the current full blob. No receiving/image/chat/new feature, schema, worker, zoom, PackingSlips or rejected notification-sharing source is included.

The source freeze is `/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r20-20261111`, fingerprint `b6f4093d05deb01c23630d6fcb223fa04a6dacf46625414a5d1ffcafa891ca4f`, 2,318 release input files. Only two runtime paths, the reviewed SW test update and one new scheduling test differ. All5,480 remaining full corpus files/configuration and all3,263 public files match R19. Exact composition, original/selected-parent/postimage hashes and patch hashes are in `perf/artifacts/phase1-r20-source-freeze-2026-11-11.json`; composition method is beside it. No source was imported from mutable HEAD.

Before compilation, the three focused suites ran against the actual frozen source: new scheduling tests, existing R19 cache tests and SW registration tests. **36 tests passed**, one worker. The operational Vitest config lives outside the fingerprinted source directories; its hashes and exact invocation are recorded. Production canonical webpack/TypeScript/prerender/source laws then passed on the first attempt with the standard frozen-source builder and pinned Node26.8.2/pnpm10.11.1/Next16.1.1/installed lock.

BUILD_ID **`e9fcb1f86b41ddb9987a260ab2879e5cbcbd7d8798b7f386dc85909ebc44cd7c`**.

| Formal gzip metric | Phase0 | R19 | R20 | Phase0 ratchet |
| --- | ---: | ---: | ---: | --- |
| Jobs shared intersection | 502,618 | 477,538 | 477,608 | Pass |
| Heaviest route reference union | 758,531 | 627,737 | 627,807 | Pass |
| Changed deployment versus Phase0 | 2,734,731 | 1,322,620 | 1,322,690 | Pass |

Each formal metric grows70 bytes versus R19. The separate strict **R19→R20 changed-current-JavaScript payload is27,818 gzip bytes: PASS<100,000**, six changed/288 current scripts and282 reused. These are actual emitted bytes for the small timer slice, not a latency claim or reinterpretation of prior failed feature-batch100KB proofs. Final shared120,000/heaviest180,000 targets remain unmet.

Offline checks decoded exact Brotli/gzip sidecars for293 current JS/CSS assets, preserved1,120 active historical static files exactly and compared all3,263 source/runtime public files. Source fingerprint/postimages/unaffected inputs remain exact after the build. Actual emitted native lookup resolves postgres3.4.8 without the earlier free-factory/numeric-dirname error. Development overlay/probe strings are absent; the one dedicated press chunk is unchanged. The canonical builder lock is released.

Complete metadata is `perf/artifacts/phase1-r20-build-proof-2026-11-11.json`; read-only inspection method is `perf/artifacts/phase1-r20-offline-proof.mjs`. First logs and full numeric reports remain `/home/tim/.openclaw/workspace/releases/speed-proof-20261110/phase1-r20-*`. No HTTP/app/browser/database/worker/journey/idle run or activation is part of this byte proof. R19 remains rejected; matching R20 runtime evidence is separate.
