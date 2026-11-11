# R17 reviewed source freeze

R17 is exact preserved R16 source plus only `src/hooks/use-drawing-shared-issue-save.ts` from `ecfa51dc`. It removes ordering of opaque optional workspace tokens and conservatively retains absent-target recovery state. The runtime SHA256 matches the isolated correction that passed the complete production diagnostic comparison. Navigation reported 127 focused tests and clean owned lint.

All sequential pre/postimages match; 5,475 unaffected source/public/scripts/vendor files and all 3,263 public files are unchanged. Configuration, package/lock/tsconfig, worker executable and R8 press exclusions remain unchanged. [The manifest](artifacts/phase1-combined-r17-source-freeze-2026-11-11.json) records exact hashes. Fingerprint: `be7f23501ec71b78974bc9f818fc75b46abfd0a4de0ad83288de7a49826c37cc` (2,316 files).

Root conditionally authorized the pinned build after these checks. R15 and R16 remain failed, separately preserved identities. No runtime or activation is authorized.

```sh
RELEASE_SOURCE_DIR=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r17-20261111 RELEASE_BUNDLE_STATS=1 node /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r17-20261111/scripts/release/build.mjs /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r17-20261111/.next-web > /home/tim/.openclaw/workspace/releases/speed-proof-20261110/phase1-r17-build.log 2>&1
```

The strict byte comparator remains completed R14; failed candidates supply no completed byte baseline.
