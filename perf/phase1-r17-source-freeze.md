# R17 reviewed source freeze

R17 is exact preserved R16 source plus only `src/hooks/use-drawing-shared-issue-save.ts` from `ecfa51dc`. It removes ordering of opaque optional workspace tokens and conservatively retains absent-target recovery state. The runtime SHA256 matches the isolated correction that passed the complete production diagnostic comparison. Navigation reported 127 focused tests and clean owned lint.

All sequential pre/postimages match; 5,475 unaffected source/public/scripts/vendor files and all 3,263 public files are unchanged. Configuration, package/lock/tsconfig, worker executable and R8 press exclusions remain unchanged. [The manifest](artifacts/phase1-combined-r17-source-freeze-2026-11-11.json) records exact hashes. Fingerprint: `be7f23501ec71b78974bc9f818fc75b46abfd0a4de0ad83288de7a49826c37cc` (2,316 files).

Root conditionally authorized the pinned build after these checks. R15 and R16 remain failed, separately preserved identities. No runtime or activation is authorized.

```sh
RELEASE_SOURCE_DIR=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r17-20261111 RELEASE_BUNDLE_STATS=1 node /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r17-20261111/scripts/release/build.mjs /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r17-20261111/.next-web > /home/tim/.openclaw/workspace/releases/speed-proof-20261110/phase1-r17-build.log 2>&1
```

The strict byte comparator remains completed R14; failed candidates supply no completed byte baseline.

## Canonical result

Build `b1c2adf31950c6f3db7ab189bbeabce29df5d6d9766418f3a9935bdde94f234b` exited 0 with production TypeScript, prerender and source-law checks passing. Source fingerprint remains unchanged and matches release manifest and stats; current scripts contain no development overlay module/string.

Formal Phase0 ratchets pass: shared 478,165 vs 502,618 gzip bytes; heaviest 627,389 vs 758,531; relative deployment 1,324,196 vs 2,734,731. Final shared 120,000/heaviest 180,000 targets still fail. The strict completed R14→R17 batch is 370,555 gzip bytes (28/288 changed, 260 reused), exceeding 100,000. This does not replace the separate earlier controlled single-edit passing proof.

The unchanged emitted-native inspection method resolves PostgreSQL metadata version 3.4.8 through the actual native namespace/default binding, with no numeric dirname or free named factory. It evaluates only the exact small metadata resolver, not application/LISTEN/database code. [Build proof](artifacts/phase1-r17-build-proof-2026-11-11.json), [static metrics](artifacts/phase1-r17-static-2026-11-11.json), [strict delta](artifacts/phase1-r17-update-delta-2026-11-11.json), [native proof](artifacts/phase1-r17-native-2026-11-11.json), and [source proof](artifacts/phase1-r17-source-proof-2026-11-11.json) preserve the checkpoint. No HTTP/runtime/activation occurred.
