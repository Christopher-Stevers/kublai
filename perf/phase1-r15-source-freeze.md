# R15 reviewed source freeze — not built

Base is immutable R14 (`a5c2aa0b130eb530ed4aee9b0c3818ae89d08ca7a00228928e8592a36c5f0096`, source fingerprint `6f5dfb9686a21a2057ef4b095f3f55cab45200a1793da0bd9563cb530b4eabf4`). Apply only the reviewed runtime diffs below. [Exact inventory](artifacts/phase1-combined-r15-source-freeze-2026-11-11.json) records every sequential preimage/postimage and patch digest.

| Group | Commit | Runtime paths |
| --- | --- | ---: |
| Executive sort target retained after authority loss | `adda6fbd` | 2 |
| Shared drawing issue ACK/uncertainty handling | `c38c454c` | 3 |
| Optional receiving resolution editor import boundary | `0bab2c39` | 3 |

All parent blobs match exactly, patches apply without conflicts, and every intermediate/final result matches its reviewed commit. Eight distinct runtime paths change; zero operational recipe changes. Tests/docs are provenance and are not overlaid into runtime source. No raw HEAD or dirty file bodies are copied.

Frozen source `/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r15-20261111`; original-source fingerprint `f4ffd52ab0633a4e0fd6f33c1b4b4b44678c83ace4b59e0e849f18bf84690d5a` (`foremanhq-lab-source-v1`, 2,316 files). All 5,468 unaffected source files and 3,263 public files match R14. Named configs, package/lockfile, tsconfig, server-only symlink targets, curated R14 operational perf inputs and fixed native resolver are unchanged. No current perf/drawing prototype, image/private data, R8 experiment, schema/worker, zoom or PackingSlips change is imported.

The optional editor slice passes 136 tests in five files, including the full 104-case workspace suite. Seven split/helper/test files lint clean; the workspace fixture retains nine exact inherited findings. Parent selection/key/authority and original controller/helper bodies remain unchanged. Only three test assertions await genuinely asynchronous resolved UI; comparison's inherited failure was reproduced independently. These are source/unit checks, not a canonical byte or timing saving claim.

Root must review this manifest before compilation. Proposed pinned command, not executed:

```sh
RELEASE_SOURCE_DIR=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r15-20261111 RELEASE_BUNDLE_STATS=1 node /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r15-20261111/scripts/release/build.mjs /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r15-20261111/.next-web
```

R14 remains separate accepted source/static/HTTP evidence; it is not evidence for the unbuilt R15. The receiving mixed chunk's 69,491 gzip bytes remain an audit bound, not promised savings. Final byte targets, changed-script ratchet and applicable functional/timing gates retain their definitions. No R15 build, server, database runtime, capture or activation has run.
