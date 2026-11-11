#!/usr/bin/env bash
set -euo pipefail
harness_root=${PERF_HARNESS_DIR:?}
snapshot=$(node "$harness_root/perf/create-lab-snapshot.mjs")
printf '%s\n' "$snapshot" > /tmp/foremanhq-press-comparison-r8-snapshot
export FOREMANHQ_BACKGROUND_MODE=separate BIM_WORKER_DISABLED=1 SKIP_ENV_VALIDATION=1
export CLERK_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_speed_lab_only
export STRIPE_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_speed_lab_only
export NEXT_PUBLIC_BUILD_ID=isolated-speed-baseline
unset NEXT_DIST_DIR NEXT_TSCONFIG_PATH FOREMANHQ_RUNTIME_DIR FOREMANHQ_PUBLIC_DIR
export PERF_LOG_DIR="$snapshot/data/openjob-r7-perf" PERF_FIXTURES="$snapshot/perf/fixtures.json"
cd "$snapshot"
./node_modules/.bin/next build --webpack > "$snapshot/build.log" 2>&1 || { tail -50 "$snapshot/build.log"; exit 1; }
export PERF_BUILD
PERF_BUILD=$(cat .next/BUILD_ID)
node --input-type=module <<'JS'
import fs from 'node:fs';const e=JSON.parse(fs.readFileSync('source-evidence.json'));if(e.sourceBuild!=='abb000ebe9cd91803e0ffea2c230d2cbf87536800cb4bb894c74f3e4583adf86'||e.sourceFingerprint!=='b4b219989f49b7d9d8bc1d70a5b613d9d8aa0285dff98a65bdc85c959fce637c'||e.sourceFileCount!==2289)throw Error('Exact R8 source required');fs.writeFileSync('/tmp/foremanhq-press-comparison-r8-source.json',JSON.stringify({...e,labBuild:process.env.PERF_BUILD,socket:process.env.PERF_LAB_SOCKET,port:3483,productionDatabase:false},null,2));
JS
./node_modules/.bin/next start --hostname 127.0.0.1 --port 3483 > /tmp/foremanhq-press-comparison-r8-server.log 2>&1 &
server_pid=$!
cleanup(){ kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
printf '%s\n' "$server_pid" > /tmp/foremanhq-press-comparison-r8-server.pid
for attempt in $(seq 1 120);do
 if curl -fsS http://127.0.0.1:3483/api/perf-lab > /dev/null 2>&1;then break;fi
 kill -0 "$server_pid" 2>/dev/null || { tail -10 /tmp/foremanhq-press-comparison-r8-server.log;exit 1; }
 sleep 1
done
PERF_BASE_URL=http://127.0.0.1:3483 node "$harness_root/perf/preflight.mjs"
cp preflight.json /tmp/foremanhq-press-comparison-r8-preflight.json
touch /tmp/foremanhq-press-comparison-r8-ready
printf '%s\n' R8_FIXTURE_READY
wait "$server_pid"
