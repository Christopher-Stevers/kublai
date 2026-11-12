#!/usr/bin/env bash
set -euo pipefail
# Root-bound identity and storage guards BEFORE private DB startup.
[[ "${PERF_EXPECTED_SOURCE_BUILD:-}" == 9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0 ]]
[[ "34f0c1508584e40382ad25955b3aa2b5703bdd78ced4e6ef2536e902fd82281d" =~ ^[a-f0-9]{64}$ ]]
export PERF_HARNESS_DIR=/tmp/foremanhq-perf-method-f9bHR6
export PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112
export PERF_SOURCE_BUILD_DIST="$PERF_SOURCE_ROOT/.next-web"
export PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq
export PERF_PG_ERROR_REPORT=/tmp/foremanhq-wizard-fastlane-compile-pg-errors.json
node /tmp/foremanhq-wizard-fastlane-storage-preflight.mjs compile
timeout --signal=TERM --kill-after=20s 6m bash "$PERF_HARNESS_DIR/perf/lab/database.sh" bash /tmp/foremanhq-wizard-fastlane-compile-only.sh
