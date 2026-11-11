#!/usr/bin/env bash
set -euo pipefail
export PERF_HARNESS_DIR=/tmp/foremanhq-perf-method-f9bHR6
export PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r17-20261111
export PERF_SOURCE_BUILD_DIST="$PERF_SOURCE_ROOT/.next-web"
export PERF_BASELINE_DIST=/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110/.next-canonical-a
export PERF_COMPARISON_BASELINE=/home/tim/.openclaw/workspace/kublai/perf/artifacts/baseline-ready-then-pinch-v2-rerun-2026-11-11-1.json
export PERF_REUSE_SNAPSHOT=/tmp/foremanhq-speed-app-epcRJM
export PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq
export PERF_PG_ERROR_REPORT=/tmp/foremanhq-r17-full-pg-errors.json
export PERF_IDLE_DURATION_MS=600000
[[ ! -e "$PERF_REUSE_SNAPSHOT/candidate.json" && ! -e "$PERF_REUSE_SNAPSHOT/idle.json" ]]
exec timeout --signal=TERM --kill-after=20s 45m bash "$PERF_HARNESS_DIR/perf/lab/database.sh" bash /tmp/foremanhq-r17-candidate120-ready-v2.sh
