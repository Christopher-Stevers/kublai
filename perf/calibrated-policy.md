# Timing calibration

The approved timing rule uses the median of 15 samples. Flag a cell only when
its median exceeds the fixed baseline by **both more than 10% and more than
17 ms**. A flagged cell gets exactly one fresh, prospectively declared set of
15 samples. Reject it only if that confirmation also fails. Preserve both sets;
never pool samples, reset the baseline or take a second confirmation.

Byte limits and polling checks are unchanged. The proposed 300 KB allowance was
withdrawn and is not part of this policy.

`calibrated-policy.mjs` requires the plan's 20 unchanged full runs: one fixed
baseline and 19 independent controls. All controls must pass the final rule.
Candidate acceptance also requires an active-source baseline/reference pair and
a candidate capture made after calibration finishes. A later active source can
use the completed method calibration, but its reference pair must still match
that source and the calibrated method.

Validation binds raw reports and prospective plans by SHA256, capture identity,
source, build, protocol and toolchain. Every requested cell needs evidence of
the private fixture restore, application shutdown, state verification, restart
and 14 read preflights. Incomplete, duplicate, stale or malformed evidence fails
closed. Health or byte failures cannot be cured by timing confirmation.

The original journey definitions and timed intervals remain unchanged. New
fixture preparation and process supervision are part of the newly calibrated
method. Historical five-sample reports remain untouched and keep their original
verdicts.

The checker, activation and small-change unit suite passes 32 cases; nine MJS
syntax checks pass. Coverage includes strict boundaries, median index 7, exact
failed-cell confirmation, raw-data binding and unchanged byte limits. Two early
test-fixture failures and their fixes are preserved with the final passing log in
`artifacts/calibrated-policy-focused-2026-11-12/`. These are software tests, not
unchanged-build timing evidence. See `STATUS.md` for actual calibration progress.
