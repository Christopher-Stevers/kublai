# R14 native resolver source freeze

Exact immutable R13 plus only `src/server/background/listen-lifecycle.ts` at `b2ca4cf42fb21db8dc3ab33b1f9227ffa9e80697`. The [single-path manifest](artifacts/phase1-native-r14-source-freeze-2026-11-11.json) records exact parent/preimage and final content hashes. Postimage SHA256 is `2852294de448d8bff026ef89c7241f2066b7ee4483366a7da0b7e7aa648098a3`; Git blob `7347ecc1b2a96f9042e4a9312c6fd7a65004d8cd`.

Frozen path: `/home/tim/.openclaw/workspace/releases/speed-phase1-native-r14-20261111`. Original-source fingerprint `6f5dfb9686a21a2057ef4b095f3f55cab45200a1793da0bd9563cb530b4eabf4` (`foremanhq-lab-source-v1`, 2,313 files). All 5,472 unaffected source files, 3,263 public files, operational perf inputs, named configs/package/lockfile/tsconfig and server-only symlink targets match R13. No current HEAD/dirty files, R8 experiment, schema/worker, PackingSlips or zoom changes enter this freeze.

Root reviewed the exact source hash and conditionally authorized the pinned canonical build after these checks and manifest commit. R13's emitted missing-binding failure remains preserved; generic compiled-fixture tests are not a substitute for inspecting R14's actual Next emission. No app/DB/server/worker runtime or activation is authorized here.

```sh
RELEASE_SOURCE_DIR=/home/tim/.openclaw/workspace/releases/speed-phase1-native-r14-20261111 RELEASE_BUNDLE_STATS=1 node /home/tim/.openclaw/workspace/releases/speed-phase1-native-r14-20261111/scripts/release/build.mjs /home/tim/.openclaw/workspace/releases/speed-phase1-native-r14-20261111/.next-web
```


## Canonical result

The pinned command exited 0 first try: webpack, production TypeScript, prerender and both source-law preflights pass. Build `a5c2aa0b130eb530ed4aee9b0c3818ae89d08ca7a00228928e8592a36c5f0096` matches the reviewed original-source fingerprint, rechecked after build. The exact one-file postimage, all 5,472 unaffected inputs and 3,263 public files remain unchanged; development overlay module/text are absent.

[Exact source/byte/native proof](artifacts/phase1-native-r14-proof-2026-11-11.json) and [reproducible emitted-only inspection](artifacts/phase1-r14-native-inspection.mjs) preserve the scope. Actual server chunk binds its namespace alias to module 98995, whose emitted external definition is `require("node:module")`. The exact isolated resolver with those real native external objects returns **3.4.8**. The namespace/default fallback is present across eight emitted copies; prior free named-factory call and numeric dirname are absent. This supplies no missing binding or patch to the candidate. It proves metadata resolution, **not actual LISTEN health or application functionality**.

Unchanged formal shared/heaviest/Phase0-relative deployment are **478,139 / 640,663 / 1,320,293 gzip bytes** (each four bytes below R13); all Phase0 byte ratchets pass. Strict R13→R14 changed payload is **20,570 gzip bytes**, five of 287 scripts changed (282 reused), passing the unchanged **100,000-byte** target. This controlled single-server-file result does not waive prior failed shared-hook/UI edits or multi-feature batches. Final 120KB shared / 180KB heaviest targets remain unmet.

R13's failed emitted-native proof and immutable build are preserved. No HTTP server, application/database runtime, full journey or activation ran for R14. Separately authorized functional evidence remains required.
