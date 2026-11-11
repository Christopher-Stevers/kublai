# Combined Phase1 source proposal

This is a source composition review, **not a built candidate or activation**. The base is the immutable R10 source: build `945730c686993e7f714af726c9351d3ed54aa846afc67333b697e6ce657d4e4a`, source fingerprint `d9c6e9cb20203dc4931aae02ed69225be6e9ac8edf86178e6dfe6462e1e3ee7f`. R10 itself is exact R9 plus the two voice-engine split files; R8 attribute feedback is absent.

The [exact inventory](artifacts/phase1-combined-source-proposal-2026-11-11.json) records commit IDs, selected paths, patch hashes, and parent/result SHA256 values. A disposable source-only patch sandbox applied each commit's selected runtime/operational diff in order. **Every selected parent blob matches exactly**, including the successive member-save, archive-width and build-tooling changes. All twelve groups apply without conflicts. No current HEAD file bodies or dirty working files were copied.

| Group | Commits | Unique runtime paths |
| --- | --- | ---: |
| Drawing folder creation | `f7112319` | 3 |
| Preference live invalidations | `168502f8` | 8 |
| Member save and bounded recovery | `326aed65`, `7f8ca0f6`, `88f9a2c4` | 4 |
| Bulk receiving feedback | `9530aaab` | 1 |
| Optional drawing removal feedback | `42748bab`, `81d7b013` | 1 |
| Optional order-send feedback | `39cefd4d` | 1 |
| Optional internal navigation telemetry | `9509b4fc` | 7 |

The navigation/provider source-law commits `27d2ddd5` and `60b1d800` add eight unique operational paths. Their builder changes are read-only preflights; canonical compiler flags and the release recipe remain unchanged. Both helpers and their JSON baseline dependencies are included, together with `scripts/check-lint.mjs` and `scripts/release/build.mjs`. Tests and documentation from implementation commits are validation provenance rather than additional production inputs.

The three optional groups above have clean exact parents; this report does not independently approve their inclusion. Internal telemetry's JobsClient hunk adds only a loading/readiness marker. It does not import the R8 usePress/PressableCard/JobsClient attribute-feedback experiment.

Preference transport requires an explicit scope decision: its `src/server/background/hints.ts` diff adds preference-event validation, transactional notification payloads and listener-reconnect reporting. This shared module is used by web-side preference writes/live delivery; it is not `background/worker.ts`. The proposal identifies it explicitly because it sits under the otherwise excluded background directory. No worker executable, schema or production database change is proposed.

Remaining before a final source freeze: receive/review the navigation preference-authority commit; root decides the optional groups and shared hint-module scope; materialize the approved exact composition; compare every unaffected source/config input and all 3,263 public files with R10; record the resulting original-source fingerprint. The present sandbox contains only paths needed for patch checks and is **not** a runnable release source. No compile, HTTP proof, journey, idle observation or activation has run for this proposal. R10's prior byte/performance evidence cannot be reused as this combined candidate's evidence.

Keep schema, worker, zoom intent, PackingSlips, package/lockfile, tsconfig and unrelated dirty source out. Applicable byte and journey gates remain unchanged; prior failures remain failures.
