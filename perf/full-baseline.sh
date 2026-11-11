#!/usr/bin/env bash
set -euo pipefail
# Freeze a copy before execution; run under perf/lab/database.sh.
harness_root=${PERF_HARNESS_DIR:?Freeze the timing harness first}
unset PERF_PILOT PERF_LINKS PERF_JOURNEYS PERF_RUNS
: "${PERF_BASELINE_DIST:?Set actual previous canonical release build directory}"
: "${PERF_SOURCE_BUILD_DIST:?Set actual canonical source release build directory}"
if [[ -n "${PERF_REUSE_SNAPSHOT:-}" ]]; then
  snapshot=$(node "$harness_root/perf/refresh-lab.mjs")
else
  snapshot=$(node "$harness_root/perf/create-lab-snapshot.mjs")
fi
export FOREMANHQ_BACKGROUND_MODE=separate BIM_WORKER_DISABLED=1 SKIP_ENV_VALIDATION=1
export CLERK_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_speed_lab_only
export STRIPE_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_speed_lab_only
export NEXT_PUBLIC_BUILD_ID=isolated-speed-baseline
unset NEXT_DIST_DIR NEXT_TSCONFIG_PATH FOREMANHQ_RUNTIME_DIR FOREMANHQ_PUBLIC_DIR
export PERF_LOG_DIR="$snapshot/data/perf"
export PERF_FIXTURES="$snapshot/perf/fixtures.json"
cd "$snapshot"
printf '%s\n' "$snapshot" > /tmp/foremanhq-speed-full-snapshot
if [[ -z "${PERF_REUSE_SNAPSHOT:-}" ]]; then
  ./node_modules/.bin/next build --webpack > "$snapshot/build.log" 2>&1 || { tail -80 "$snapshot/build.log"; exit 1; }
fi
export PERF_BUILD=$(cat .next/BUILD_ID)
export PERF_BASE_URL=http://127.0.0.1:3481 PERF_JOURNEY_ADAPTER="$harness_root/perf/journeys.mjs"
server_pid=
cleanup() { if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM
start_server() {
  ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3481 >> "$snapshot/server.log" 2>&1 &
  server_pid=$!
  for attempt in $(seq 1 120); do
    if curl -fsS http://127.0.0.1:3481/api/perf-lab > /dev/null 2>&1; then return; fi
    sleep 1
  done
  tail -50 "$snapshot/server.log"; exit 1
}
node "$harness_root/scripts/release/static-metrics.mjs" "$PERF_SOURCE_BUILD_DIST" "$PERF_BASELINE_DIST" > "$snapshot/static-bytes.json"
node "$harness_root/scripts/release/static-metrics.mjs" "$snapshot/.next" "$PERF_BASELINE_DIST" > "$snapshot/lab-static-bytes.json"
start_server
node "$harness_root/perf/preflight.mjs"
PERF_IDLE_OUTPUT="$snapshot/idle.json" node "$harness_root/perf/idle.mjs"
node --input-type=module -e 'import fs from "node:fs";const bytes=JSON.parse(fs.readFileSync("static-bytes.json"));const idle=JSON.parse(fs.readFileSync("idle.json"));if(bytes.build!==idle.sourceBuild)throw Error("Canonical static and idle source build mismatch");fs.writeFileSync("static.json",JSON.stringify({...bytes,idlePolls:idle.idlePolls,idleEvidence:idle},null,2));'
export PERF_STATIC_REPORT="$snapshot/static.json"
for capture in 1 2; do
  cleanup; server_pid=
  node "$harness_root/perf/lab/reset-writes.mjs"
  start_server
  PERF_OUTPUT="$snapshot/baseline-$capture.json" node "$harness_root/perf/run.mjs"
  printf '%s\n' "Independent complete capture $capture finished."
done
node "$harness_root/perf/check.mjs" --repeatability --baseline "$snapshot/baseline-1.json" --report "$snapshot/baseline-2.json" > "$snapshot/repeatability.txt" 2>&1 || { cat "$snapshot/repeatability.txt"; exit 1; }
cat "$snapshot/repeatability.txt"
