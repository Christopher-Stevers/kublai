#!/usr/bin/env bash
set -euo pipefail
# Root-bound identity and storage guards BEFORE private DB startup.
[[ "${PERF_EXPECTED_SOURCE_BUILD:-}" == e9fcb1f86b41ddb9987a260ab2879e5cbcbd7d8798b7f386dc85909ebc44cd7c ]]
[[ "b6f4093d05deb01c23630d6fcb223fa04a6dacf46625414a5d1ffcafa891ca4f" =~ ^[a-f0-9]{64}$ ]]
export PERF_HARNESS_DIR=/tmp/foremanhq-perf-method-f9bHR6
export PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r20-20261111
export PERF_SOURCE_BUILD_DIST="$PERF_SOURCE_ROOT/.next-web"
export PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq
export PERF_PG_ERROR_REPORT=/tmp/foremanhq-r20-compile-pg-errors.json
node /tmp/foremanhq-r20-storage-preflight.mjs compile
timeout --signal=TERM --kill-after=20s 6m bash "$PERF_HARNESS_DIR/perf/lab/database.sh" bash /tmp/foremanhq-r20-compile-only.sh
