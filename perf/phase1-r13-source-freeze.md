# R13 reviewed source and failed native-lookup proof

Base is immutable R12 build `d18cbd7b82933e2e0dc0999ccfcf2054aa7cf095946de1a379d6b0365e8b7736`, source fingerprint `f8aea0644b7c7471a1bdae597535001c44a6e0a337b8ef875da68e9c24327c09`. Only the following reviewed runtime diffs are applied. The [exact manifest](artifacts/phase1-combined-r13-source-freeze-2026-11-11.json) records every preimage/postimage and patch digest.

| Group | Commit | Runtime paths |
| --- | --- | ---: |
| Explicit chat join feedback | `d434e254` | 2 |
| Catalogue creation ownership/ACK feedback | `3a814154` | 3 |
| Native PostgreSQL runtime-version resolution | `da025bf3` | 1 |
| Transactional timesheet hints / context fallback retained | `18023b1e` | 9 |

All sequential parent bytes match exactly; all patches apply without conflicts and every intermediate/final result matches its reviewed commit. Fifteen distinct runtime files change, with no operational recipe changes. No raw HEAD file bodies or dirty working files are copied. Tests and documentation from source commits are provenance, not additional runtime inputs.

Frozen source: `/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r13-20261111`. Original-source fingerprint: `f680801e77896905e0ee8859a7967221c9fe12bb2b3ef79e0a9fa4aad64ebd4e` (`foremanhq-lab-source-v1`, 2,313 files). All 5,458 unaffected source inputs and every one of the 3,263 public files match R12. Named configs, package/lockfile, tsconfig, worker executable, schema, zoom intent, PackingSlips and R8 attribute-feedback trio are unchanged. Shared background hint/listener code is the explicitly approved web-side bridge, not a worker release.

Root independently reviewed all final postimages and sequential preimages, then authorized this pinned canonical command, which exited 0:

```sh
RELEASE_SOURCE_DIR=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r13-20261111 RELEASE_BUNDLE_STATS=1 node /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r13-20261111/scripts/release/build.mjs /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r13-20261111/.next-web
```

Timesheet source validation is recorded separately: 47 focused tests and 13 isolated PostgreSQL tests pass, scoped lint clean. It removes zero polls and retains the 30-second context authority fallback. Other source groups retain their reviewed focused tests/compiled-fixture evidence; none is substituted for a matching canonical build, functional run, full journey or timing gate. R12's byte improvement and failed changed-script/final targets remain R12 evidence. R13 canonical webpack, production TypeScript, prerender and source-law preflights passed first try. [The exact proof](artifacts/phase1-combined-r13-proof-2026-11-11.json) binds build `c7d07b32a3dd4c6da6fd4fb3a3d1f9ab04c163ee0a5e61948871c2b68e912813` to the reviewed original source, rechecked after build. All 15 runtime changes, 5,458 unaffected files and 3,263 public files remain exact; development overlay module/text are absent.

**Native resolver inspection fails.** Actual server chunks no longer call dirname on a numeric module ID, but instead emit a free `createRequire` identifier. Representative `server/chunks/4735.js` has only one occurrence, at `Reflect.apply(createRequire, …).resolve("postgres")`, with no binding in its CommonJS scope. The catch returns null, leaving listener readiness false. [The reproducible inspection](artifacts/phase1-r13-native-inspection.mjs) extracts only that exact metadata resolver, never loads an app bundle or database code, and observes null. A diagnostic control supplying the missing native binding returns 3.4.8; this does not patch the candidate or convert the failed check into a pass. Other emitted copies exhibit the same missing binding. Frozen R13 is preserved unchanged, and app/lab runtime is held pending a separately reviewed correction.

Formal shared/heaviest/Phase0-relative deployment are **478,143 / 640,667 / 1,320,297 gzip bytes**, increases of 27 / 26 / 3,968 from R12. All three Phase0 byte ratchets pass. Strict R12→R13 changed payload **359,750 gzip bytes** (32/287 scripts changed, 255 reused) fails the unchanged 100,000-byte target. Final 120KB shared / 180KB heaviest targets remain unmet.

No R13 HTTP server, app/database runtime, timing capture, full journey or activation ran. Successful compilation and byte ratchets do not establish listener functionality or release readiness.
