#!/usr/bin/env bash
set -euo pipefail
# Run only under perf/lab/database.sh, with its disposable database alive.
snapshot=$(node perf/create-lab-snapshot.mjs)
export FOREMANHQ_BACKGROUND_MODE=separate
export BIM_WORKER_DISABLED=1
export SKIP_ENV_VALIDATION=1
export CLERK_SECRET_KEY=sk_test_speed_lab_only
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_speed_lab_only
export STRIPE_SECRET_KEY=sk_test_speed_lab_only
export NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_speed_lab_only
export NEXT_PUBLIC_BUILD_ID=isolated-speed-pilot
unset NEXT_DIST_DIR NEXT_TSCONFIG_PATH FOREMANHQ_RUNTIME_DIR FOREMANHQ_PUBLIC_DIR
cd "$snapshot"
printf '%s\n' "$snapshot" > /tmp/foremanhq-speed-latest-snapshot
while ! ./node_modules/.bin/next build --webpack > "$snapshot/build.log" 2>&1; do
  tail -80 "$snapshot/build.log"
  printf '%s\n' "Lab build failed; waiting up to five minutes for $snapshot/.retry-build"
  for attempt in $(seq 1 300); do
    if [[ -f "$snapshot/.retry-build" ]]; then rm "$snapshot/.retry-build"; break; fi
    sleep 1
  done
  if [[ "$attempt" == 300 ]]; then exit 1; fi
done
export PERF_BUILD=$(cat .next/BUILD_ID)
./node_modules/.bin/next start --hostname 127.0.0.1 --port 3481 > "$snapshot/server.log" 2>&1 &
server_pid=$!
cleanup() { kill "$server_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
for attempt in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:3481/api/perf-lab > /dev/null; then break; fi
  sleep 1
done
PERF_PILOT=1 PERF_BASE_URL=http://127.0.0.1:3481 PERF_JOURNEY_ADAPTER=./perf/journeys.mjs PERF_OUTPUT="$snapshot/pilot.json" node perf/run.mjs
