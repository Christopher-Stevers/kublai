# R13 reviewed source freeze — not built

Base is immutable R12 build `d18cbd7b82933e2e0dc0999ccfcf2054aa7cf095946de1a379d6b0365e8b7736`, source fingerprint `f8aea0644b7c7471a1bdae597535001c44a6e0a337b8ef875da68e9c24327c09`. Only the following reviewed runtime diffs are applied. The [exact manifest](artifacts/phase1-combined-r13-source-freeze-2026-11-11.json) records every preimage/postimage and patch digest.

| Group | Commit | Runtime paths |
| --- | --- | ---: |
| Explicit chat join feedback | `d434e254` | 2 |
| Catalogue creation ownership/ACK feedback | `3a814154` | 3 |
| Native PostgreSQL runtime-version resolution | `da025bf3` | 1 |
| Transactional timesheet hints / context fallback retained | `18023b1e` | 9 |

All sequential parent bytes match exactly; all patches apply without conflicts and every intermediate/final result matches its reviewed commit. Fifteen distinct runtime files change, with no operational recipe changes. No raw HEAD file bodies or dirty working files are copied. Tests and documentation from source commits are provenance, not additional runtime inputs.

Frozen source: `/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r13-20261111`. Original-source fingerprint: `f680801e77896905e0ee8859a7967221c9fe12bb2b3ef79e0a9fa4aad64ebd4e` (`foremanhq-lab-source-v1`, 2,313 files). All 5,458 unaffected source inputs and every one of the 3,263 public files match R12. Named configs, package/lockfile, tsconfig, worker executable, schema, zoom intent, PackingSlips and R8 attribute-feedback trio are unchanged. Shared background hint/listener code is the explicitly approved web-side bridge, not a worker release.

Root must review the final manifest before a canonical build. Proposed pinned command, not executed:

```sh
RELEASE_SOURCE_DIR=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r13-20261111 RELEASE_BUNDLE_STATS=1 node /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r13-20261111/scripts/release/build.mjs /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r13-20261111/.next-web
```

Timesheet source validation is recorded separately: 47 focused tests and 13 isolated PostgreSQL tests pass, scoped lint clean. It removes zero polls and retains the 30-second context authority fallback. Other source groups retain their reviewed focused tests/compiled-fixture evidence; none is substituted for a matching canonical build, functional run, full journey or timing gate. R12's byte improvement and failed changed-script/final targets remain R12 evidence. No R13 compile, server, database runtime, timing capture or activation has run.
