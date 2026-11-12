#!/usr/bin/env bash
set -euo pipefail
export PERF_HARNESS_DIR=/tmp/foremanhq-perf-method-f9bHR6
export PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112
export PERF_SOURCE_BUILD_DIST="$PERF_SOURCE_ROOT/.next-web"
export PERF_BASELINE_DIST=/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110/.next-canonical-a
export PERF_COMPARISON_BASELINE=/home/tim/.openclaw/workspace/kublai/perf/artifacts/wizard-fastlane-ready-then-pinch-v2-2026-11-12/report.json
export PERF_REUSE_SNAPSHOT=/tmp/foremanhq-speed-app-fxHxrn
export PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq
export PERF_PG_ERROR_REPORT=/tmp/foremanhq-active-wizard-repeat-full-v2-pg-errors.json
export PERF_IDLE_DURATION_MS=600000
export PERF_SHEET_PROTOCOL=ready-then-pinch-v2
export PERF_DIAGNOSTICS=0
export CHROMIUM_PATH=/usr/bin/chromium
export PERF_RUN_EVIDENCE_DIR=/tmp/foremanhq-active-wizard-repeat-full-v2-evidence
# Fail BEFORE DB startup or any owned-output removal.
node /tmp/foremanhq-active-wizard-repeat-reference-guard.mjs > /tmp/foremanhq-active-wizard-repeat-effective-environment-before-db.json
node /tmp/foremanhq-active-wizard-repeat-storage-preflight.mjs full
[[ ! -e "$PERF_RUN_EVIDENCE_DIR" ]]
mkdir -m 700 "$PERF_RUN_EVIDENCE_DIR"
cp /tmp/foremanhq-active-wizard-repeat-effective-environment-before-db.json "$PERF_RUN_EVIDENCE_DIR/effective-environment-before-db.json"
# Save all prior generated outputs before removing only exact owned filenames.
[[ "$PERF_REUSE_SNAPSHOT" == /tmp/foremanhq-speed-app-fxHxrn && -f "$PERF_REUSE_SNAPSHOT/PERF_LAB_ONLY" ]]
[[ "$(cat "$PERF_REUSE_SNAPSHOT/.next/BUILD_ID")" == wTBAqKGVn-GRqajiTebMf ]]
mkdir -m 700 "$PERF_RUN_EVIDENCE_DIR/prior-outputs"
for name in source-evidence.json perf/fixtures.json;do
  cp "$PERF_REUSE_SNAPSHOT/$name" "$PERF_RUN_EVIDENCE_DIR/prior-outputs/${name//\//-}"
  cmp "$PERF_REUSE_SNAPSHOT/$name" "$PERF_RUN_EVIDENCE_DIR/prior-outputs/${name//\//-}"
done
for name in baseline-repeatability.txt validation-status.json candidate.json idle.json preflight.json static-bytes.json lab-static-bytes.json static.json candidate-regression.txt server.log; do
  if [[ -f "$PERF_REUSE_SNAPSHOT/$name" ]]; then
    cp "$PERF_REUSE_SNAPSHOT/$name" "$PERF_RUN_EVIDENCE_DIR/prior-outputs/$name"
    cmp "$PERF_REUSE_SNAPSHOT/$name" "$PERF_RUN_EVIDENCE_DIR/prior-outputs/$name"
    rm -- "$PERF_REUSE_SNAPSHOT/$name"
  fi
done
exec timeout --signal=TERM --kill-after=20s 45m bash "$PERF_HARNESS_DIR/perf/lab/database.sh" bash /tmp/foremanhq-active-wizard-repeat-candidate120-ready-v2.sh
