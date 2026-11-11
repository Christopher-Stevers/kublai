# Supplemental pair summary

The frozen runner's existing `summarize.mjs` pools all supplied captures into a
single per-build distribution. Existing assessment JSON records hashes and gate
errors. Neither provides an independently reproducible, separate-first/second
view of all 24 cells with source/method/health metadata and stage coverage.

After the reserved timing window ends:

```sh
node perf/summarize-pair.mjs first.json second.json > pair-summary.json
node --test perf/summarize-pair.test.mjs
```

This independent tool is deliberately absent from `HARNESS_FILES`; it changes
neither an existing capture nor its frozen method hash. It reads the original
bytes, emits their exact SHA-256 hashes, and never writes either report. The CLI
also records its own source hash and the validator/budget dependency hashes. No raw report, stage occurrence, run, outlier
or failed cell is discarded. Missing stages remain missing, never zero-filled.
Malformed/incomplete reports or mismatched build/source/method/protocol/toolchain
are rejected. Inputs must contain independently complete captures, not five-run
diagnostics or duplicated reports.

The existing `validateReport` and `checkRepeatability` functions remain the
validation/noise authorities. All 24 wallclock cell medians and signed deltas
are reported. A valid pair that fails repeatability still produces the full
summary and exits 1; invalid inputs produce an error and no derived summary.
Five-run descriptive p95 is the maximum, not statistically established p95.
Optional browser stages include every recorded occurrence per run and have
separate first/second distributions; they are paint-opportunity proxies.

Capture-start and database-observation timestamps are copied exactly. A database
observation is not relabeled as capture completion; an unrecorded completion
stays null. Endpoint/preflight/schema/error counts are metadata, not hidden timing
exclusions. This summary neither substitutes for canonical release binding nor
claims accepted Phase0, physical-device results, final targets, or deployment
permission. Current reports and budgets remain unmodified.

Seven synthetic tests passed after explicit quiet release. The complete sealed
v2 rerun was summarized with all 24 cells passing the existing repeatability
validator; both raw file hashes match the reviewed assessment. This verifies
the supplemental tool and same-build repeatability, not broader release gates.
