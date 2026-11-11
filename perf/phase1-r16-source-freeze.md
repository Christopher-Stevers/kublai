# R16 reviewed source freeze

R15 passed webpack but failed production TypeScript at DrawingWorkspace.tsx:1072: nullable data was supplied to an optional undefined-only workspace input. Its source remains unchanged; the first build log is retained as `phase1-r15-build-attempt1.log` in the external proof directory. No completed R15 build, static result, runtime or activation is claimed.

R16 copies the exact R15 frozen source and applies only `DrawingWorkspace.tsx` from `9cbe46d7`: `workspace: data ?? undefined`. The commit parent exactly matches the R15 file; all 5,475 unaffected source/public/scripts/vendor files, all 3,263 public files, configuration, package/lock/tsconfig and server-only symlink targets remain unchanged. R8 press changes, unrelated working changes, schema and worker executable changes remain excluded.

The source fingerprint is `a41fa2a6ebe83463e396ca612bbae2e72aa670f8d5cb5b868fc0e5a1ae0152f6` (`foremanhq-lab-source-v1`, 2,316 files). Exact sequential hashes are in [the manifest](artifacts/phase1-combined-r16-source-freeze-2026-11-11.json). This checkpoint is source-only, awaiting root verification and build clearance.

The pinned command after clearance is:

```sh
RELEASE_SOURCE_DIR=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r16-20261111 RELEASE_BUNDLE_STATS=1 node /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r16-20261111/scripts/release/build.mjs /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r16-20261111/.next-web > /home/tim/.openclaw/workspace/releases/speed-proof-20261110/phase1-r16-build.log 2>&1
```

The latest completed byte comparator is R14; failed R15 has no completed build suitable for a static delta. No runtime or activation is authorized by this source checkpoint.

After root verification, the pinned canonical attempt passed navigation/provider source laws and webpack, then failed production TypeScript at `use-drawing-shared-issue-save.ts:316` because `old.revision` is possibly undefined. The attempt log is preserved separately as `phase1-r16-build-attempt1.log`; [failure metadata](artifacts/phase1-r16-failed-compile-2026-11-11.json) records its hash. R16 source remains unchanged. No completed build identity, static bytes or native resolver proof is claimed. Any corrected retry requires a separate reviewed source identity.
