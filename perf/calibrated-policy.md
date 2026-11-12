# Timing calibration source preparation

Source and narrow unit validation only; no actual calibration or candidate capture exists.
The user's later instruction kept all byte limits unchanged and superseded the
unadopted300KB proposal, whose diff was retained outside active code. Timing rule:
median of15, reject only delta>baseline×0.10 AND delta>17ms, then one fresh
predeclared15 per exact failed set; no pooling/reset/second confirmation.

`calibrated-policy.mjs` validates completed20-full-run method calibration and a
separate active-source reference pair plus candidate. Exact raw report and plan
SHA256, prospective seal times, capture IDs, roles, source/build/protocol/toolchain,
source transforms/static provenance, private DB health and complete requested
cells are checked. Every control remains the same source/build as calibration B;
future reference source may differ but method must match. Calibration rejects
started/incomplete/duplicate/mismatched records, and all19 controls must pass the
final directional rule. Fresh candidate references are not a source waiver.

The operational capture plan/driver is separately owned and reviewed. In
particular fixturePrelude must declare equivalent initial and confirmation cell
state before capture. No fake sample or field telemetry substitutes for these
new method-bound measurements. Historical f9/v2 captures remain untouched.

Prepared tests cover median index7, strict equality, missing/incomplete calibration,
all20 raw runs, faster controls, independent active source, exact sole confirmation,
failed subset/duplicate run/stale plan/wrongsource/second retry/raw tampering,
negative duration and unchanged byte non-growth. Narrow units are now32unique passing cases (15policy,7existing checker,5activation,4switch,1small-change). Initial run29/30passed; one planted activation fixture had not rebound changed rawreport evidence and was corrected to reach the intended regression check. A later chronology fixture needed its certificate timestamps moved coherently; both failed logs remain. Impacted reruns passed,9ownedMJS syntax checks plus3updated checks clean. Byte small-change script/tests and all budgets.targets remain exact preproposal HEAD. No DB/browser/matrix or candidate activation. Root still reviews integration and prospective state contracts before any collection.
