# Stroke-v3 single-page host protocol — source prepared only

No PDF reads, imports, tests, type checks, formatting, raster, browser or build
were executed while preparing this protocol. Historical reports/previews and
legacy metric function remain untouched. No production/worker/DB/new dependency
change. This is not a complete encoding, production go, phone or corpus claim.

## Exact invocation and isolation

Future execution requires all three explicit inputs:

- `DRAWING_STROKE_V3=1`;
- `DRAWING_ONLY_HASH=268d1043b94a91e45a813bd7c62f1ad966a0515045984de3536123c16fb00215`;
- absolute `DRAWING_STROKE_V3_OUTPUT` direct child of existing
  `perf/drawings/private`, named `stroke-v3-<unique-attempt>`.

No legacy prototype flag may also be set, even to0. Only shard0of1 is allowed;
malformed/negative/fractional/zero-total shard values reject. Missing/truncated/
mismatched full hash, duplicate/missing corpus match, wrong actual PDF byte hash,
missing helper input or invalid output parent rejects before output creation.
No other sample is selected, reused or resumed. Exact widths are512and1024.

The new output directory is created exclusively, without recursive replacement.
A previous successful OR failed directory cannot be reused. Previews live only
under its new `previews` child; final `result.json` uses exclusive creation. A
failed attempt is retained, never retried or overwritten automatically. Source
hash mismatch after execution rejects; it cannot be relabelled as a pass. A
run-start manifest is written immediately after exclusive reservation. Final
source-read/change, parse/render/support/fidelity or PDF cleanup failure preserves
error/before/after metadata and returns nonzero; private logs/images are not
committed. Native/font/CMap/WASM transitive inputs are explicitly not
exhaustively fingerprinted.

## Evidence and decision

Before reservation, the runner records SHA256 of its exact source, operators,
image resource helper, new stroke-style helper, invocation helper, fidelity helper, support audit, corpus manifest,
package/lock, installed pdf.js package+reference implementation and canvas package.
Actual reference PDF bytes must equal the full allowlisted hash. The bytes used
to parse the corpus manifest must match its recorded input hash; installed
legacy pdf.js source must match the pinned v2 reference SHA256
`842284e0d1d439e60701e3355c2128cd3016ebebf14220e27f512467682aad66`
before any output reservation. Inputs are
hashed again afterward. Future execution must additionally record Node/native
canvas binary/tool versions and the owned process supervisor provenance in the
attempt wrapper; package metadata alone is not a native binary attestation.

Only v3 enables `resources.strokeStyles:true`; historical replay defaults remain.
The root-owned support audit and navigation-owned stroke replay failures are
combined with image-resource failures, missing text/image replay, classification
unsupported flags and scan-candidate fallback. No omission may be ignored to
obtain a passing sheet decision. Marked/layer/unknown state remains unsupported
when encountered. v3 reports actual omissions; unchanged legacy branches retain
their original omission arrays and metric implementation.

The separate fidelity helper preserves existing64px tile/luminance/SSIM/ink
thresholds and rejects malformed/nonopaque inputs. The sheet decision requires
both requested widths, valid passing comparisons, explicit support/resources
success and no remaining omission/fallback. Only new v3 canvas allocation uses the exact requested integer width512/1024
rather than ceil(viewport.width), avoiding a floating-precision513allocation;
viewport transform and reference/prototype dimensions remain identical. The
comparison checks actual integer width equals its requested tag. Historical
modes retain the original ceil allocation. No image resampling is performed.
Only bounded worst-tile coordinates/scores/counts are reported. Always retain
`completeEncoding:false`, `productionEligible:false`, `productionChanged:false`.
Numeric host fidelity does not establish broad PDF/text/production support.

## Future bounded recipe (scheduled after calibration; not yet run)

After calibration quiet ends and root schedules validation: run the focused
invocation/operator/support/fidelity tests and existing scoped TypeScript checks,
review the exact source/installed inputs, and seal BEFORE hashes. For one approved
same-page attempt, require fresh output AND fresh supervisor/log paths, then use
existing owned-process-supervisor.py with `--seconds 180` around the normal `tsx
perf/drawings/run.ts` command and the three explicit env values above. Keep the
supervisor record/log beside, not inside, the still-uncreated output directory.
No credentials, external network, other page or automatic retry. Inspect both
reference/prototype private image pairs under the PDF workflow after cleanup;
record numeric failures and visible discrepancies honestly. Confirm owned family
absence, no leftover PDF process and AFTER hashes. Preserve any failure intact.

Prepared tests cover mode/shard/hash rejection and exclusive failed-output
preservation without real PDF input. They are authored but unexecuted. Root must
review API alignment and the wrapper before any runtime collection.
