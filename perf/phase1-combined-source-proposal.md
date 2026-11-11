# Combined Phase1 source proposal

This is the reviewed R11 source composition. It subsequently compiled successfully; **it has not been activated**. The base is the immutable R10 source: build `945730c686993e7f714af726c9351d3ed54aa846afc67333b697e6ce657d4e4a`, source fingerprint `d9c6e9cb20203dc4931aae02ed69225be6e9ac8edf86178e6dfe6462e1e3ee7f`. R10 itself is exact R9 plus the two voice-engine split files; R8 attribute feedback is absent.

The [initial inventory](artifacts/phase1-combined-source-proposal-2026-11-11.json) is retained. The [final frozen inventory](artifacts/phase1-combined-r11-source-freeze-2026-11-11.json) records commit IDs, selected paths, patch hashes, and parent/result SHA256 values. A disposable source-only patch sandbox applied each commit's selected runtime/operational diff in order. **Every selected parent blob matches exactly**, including the successive member-save, archive-width and build-tooling changes. All thirteen groups apply without conflicts, including the later reviewed authority group. No current HEAD file bodies or dirty working files were copied.

| Group | Commits | Unique runtime paths |
| --- | --- | ---: |
| Drawing folder creation | `f7112319` | 3 |
| Preference live invalidations | `168502f8` | 8 |
| Preference HTTP authority / listener recovery | `bd02918b` | 9 (6 overlap transport) |
| Member save and bounded recovery | `326aed65`, `7f8ca0f6`, `88f9a2c4` | 4 |
| Bulk receiving feedback | `9530aaab` | 1 |
| Optional drawing removal feedback | `42748bab`, `81d7b013` | 1 |
| Optional order-send feedback | `39cefd4d` | 1 |
| Optional internal navigation telemetry | `9509b4fc` | 7 |

The navigation/provider source-law commits `27d2ddd5` and `60b1d800` add eight unique operational paths. Their builder changes are read-only preflights; canonical compiler flags and the release recipe remain unchanged. Both helpers and their JSON baseline dependencies are included, together with `scripts/check-lint.mjs` and `scripts/release/build.mjs`. Tests and documentation from implementation commits are validation provenance rather than additional production inputs.

Root approved the three originally optional groups above for the final freeze; they have clean exact parents. Internal telemetry's JobsClient hunk adds only a loading/readiness marker. It does not import the R8 usePress/PressableCard/JobsClient attribute-feedback experiment.

Root explicitly approved the shared web-side bridge: its `src/server/background/hints.ts` diff adds preference-event validation, transactional notification payloads and listener-reconnect reporting. This shared module is used by web-side preference writes/live delivery; it is not `background/worker.ts`. The proposal identifies it explicitly because it sits under the otherwise excluded background directory. No worker executable, schema or production database change is proposed.

The final frozen source is `/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r11-20261111`: 28 runtime and eight operational paths differ from R10. All 5,428 unaffected source inputs and every one of the 3,263 public files match R10; named configs, package/lockfile and tsconfig are unchanged. Original-source fingerprint is `71410fbee1832a3dc141c47ef790edf9093c6e5146beac3842534503f7a8b0f3` (`foremanhq-lab-source-v1`, 2,304 files). The later scale and merge-feedback slices are excluded.

Preparation attempt 1 stopped at the first postimage assertion because `git apply` from inside an enclosing repository skipped patch paths; its directory is preserved. Attempt 2 applies to an explicit absolute destination from `/tmp`, checks every intermediate postimage, and passes the complete unaffected/public comparison. No failed preparation is presented as a successful freeze.

Root reviewed the freeze and authorized the following pinned canonical command, which exited 0:

```sh
RELEASE_SOURCE_DIR=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r11-20261111 RELEASE_BUNDLE_STATS=1 node /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r11-20261111/scripts/release/build.mjs /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r11-20261111/.next-web
```

R11's canonical webpack compilation, production TypeScript and prerendering passed first try. Source-law preflights passed. Build is `ae52a68dd64be4099077ac95c7ad489255c3501dda164a7d5b9bf023ee95d668`; its fingerprint matches the reviewed source, and all 36 overlays plus unaffected/public inputs were rechecked. The actual `SpeedDevelopmentOverlay` module and development overlay text are absent from production output.

[The candidate byte report](artifacts/phase1-combined-r11-byte-2026-11-11.json) records all unchanged gates. Shared is **477,954**, heaviest **757,796** (receiving), and Phase0-relative deployment **1,293,940 gzip bytes**. These rise by 3,996 / 8,562 / 22,301 from R10, but all three Phase0 ratchets still pass. The heaviest ratchet has only **735 bytes** of headroom. Final 120KB shared / 180KB heaviest targets remain unmet. Strict R10→R11 changed payload is **441,018 gzip bytes**, 43/284 scripts changed (241 reused), so the unchanged **100,000-byte target fails**. This feature-batch comparison is distinct from earlier controlled single-leaf edit evidence.

No HTTP proof, browser journey, idle observation, full candidate matrix or activation ran for R11. R10's prior runtime evidence is not presented as matching R11 evidence, and previous failed gates remain unchanged.

Keep schema, worker, zoom intent, PackingSlips, package/lockfile, tsconfig and unrelated dirty source out. Applicable byte and journey gates remain unchanged; prior failures remain failures.
