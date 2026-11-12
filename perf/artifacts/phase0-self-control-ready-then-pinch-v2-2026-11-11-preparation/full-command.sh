#!/usr/bin/env bash
set -euo pipefail
export PERF_HARNESS_DIR=/tmp/foremanhq-perf-method-f9bHR6
export PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110
export PERF_SOURCE_BUILD_DIST="$PERF_SOURCE_ROOT/.next-canonical-a"
export PERF_BASELINE_DIST=/home/tim/.openclaw/workspace/releases/foremanhq-job-numbering-20261110/.next
export PERF_COMPARISON_BASELINE=/home/tim/.openclaw/workspace/kublai/perf/artifacts/baseline-ready-then-pinch-v2-rerun-2026-11-11-1.json
export PERF_REUSE_SNAPSHOT=/tmp/foremanhq-speed-app-5h2kmq
export PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq
export PERF_PG_ERROR_REPORT=/tmp/foremanhq-phase0-control-full-v2-pg-errors.json
export PERF_IDLE_DURATION_MS=600000
export PERF_CONTROL_ONLY=phase0-self-comparison
export PERF_DIAGNOSTICS=0
export CHROMIUM_PATH=/usr/bin/chromium
export PERF_STABILITY_REFERENCE=/home/tim/.openclaw/workspace/kublai/perf/artifacts/baseline-ready-then-pinch-v2-rerun-2026-11-11-2.json
export PERF_SHEET_PROTOCOL=ready-then-pinch-v2
export PERF_RUN_EVIDENCE_DIR=/tmp/foremanhq-phase0-control-full-v2-evidence
# Fail BEFORE DB startup or any owned-output removal.
node /tmp/foremanhq-phase0-control-only-guard.mjs > /tmp/foremanhq-phase0-control-effective-environment-before-db.json
node /tmp/foremanhq-phase0-control-storage-preflight.mjs control
[[ ! -e "$PERF_RUN_EVIDENCE_DIR" ]]
mkdir -m 700 "$PERF_RUN_EVIDENCE_DIR"
cp /tmp/foremanhq-phase0-control-effective-environment-before-db.json "$PERF_RUN_EVIDENCE_DIR/effective-environment-before-db.json"
# Save all prior generated outputs before removing only exact owned filenames.
[[ "$PERF_REUSE_SNAPSHOT" == /tmp/foremanhq-speed-app-5h2kmq && -f "$PERF_REUSE_SNAPSHOT/PERF_LAB_ONLY" ]]
[[ "$(cat "$PERF_REUSE_SNAPSHOT/.next/BUILD_ID")" == cI20Tzl0OAQscfvjfmtFW ]]
printf '{"controlOnly":true,"releaseCandidate":false,"doesNotClearR20":true,"prospectiveTrial":1}\n' > "$PERF_RUN_EVIDENCE_DIR/control-purpose.json"
mkdir -m 700 "$PERF_RUN_EVIDENCE_DIR/prior-outputs"
for name in source-evidence.json perf/fixtures.json;do
  cp "$PERF_REUSE_SNAPSHOT/$name" "$PERF_RUN_EVIDENCE_DIR/prior-outputs/${name//\//-}"
  cmp "$PERF_REUSE_SNAPSHOT/$name" "$PERF_RUN_EVIDENCE_DIR/prior-outputs/${name//\//-}"
done
for name in control.json idle.json preflight.json static-bytes.json lab-static-bytes.json static.json control-comparison.txt server.log; do
  if [[ -f "$PERF_REUSE_SNAPSHOT/$name" ]]; then
    cp "$PERF_REUSE_SNAPSHOT/$name" "$PERF_RUN_EVIDENCE_DIR/prior-outputs/$name"
    cmp "$PERF_REUSE_SNAPSHOT/$name" "$PERF_RUN_EVIDENCE_DIR/prior-outputs/$name"
    rm -- "$PERF_REUSE_SNAPSHOT/$name"
  fi
done
exec timeout --signal=TERM --kill-after=20s 45m bash "$PERF_HARNESS_DIR/perf/lab/database.sh" bash /tmp/foremanhq-phase0-control-candidate120-ready-v2.sh
