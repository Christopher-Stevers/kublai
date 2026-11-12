#!/usr/bin/env bash
set -euo pipefail
harness=${PERF_HARNESS_DIR:?}
: "${PERF_EXPECTED_SOURCE_BUILD:?Root-reviewed wizard fastlane build identity required}"
[[ "$PERF_EXPECTED_SOURCE_BUILD" =~ ^[a-f0-9]{64}$ ]]
[[ "$harness" == /tmp/foremanhq-perf-method-f9bHR6 ]]
[[ "${PERF_SOURCE_ROOT:?}" == /home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112 ]]
[[ "${PERF_SOURCE_BUILD_DIST:?}" == "$PERF_SOURCE_ROOT/.next-web" ]]
[[ "$(cat "$PERF_SOURCE_BUILD_DIST/BUILD_ID")" == "$PERF_EXPECTED_SOURCE_BUILD" ]]
export FOREMANHQ_BACKGROUND_MODE=separate BIM_WORKER_DISABLED=1 SKIP_ENV_VALIDATION=1
export CLERK_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_speed_lab_only
export STRIPE_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_speed_lab_only
export NEXT_PUBLIC_BUILD_ID=isolated-speed-baseline
unset NEXT_DIST_DIR NEXT_TSCONFIG_PATH FOREMANHQ_RUNTIME_DIR FOREMANHQ_PUBLIC_DIR
evidence_dir=/tmp/foremanhq-wizard-fastlane-compile-evidence
[[ ! -e "$evidence_dir" ]]
mkdir -m 700 "$evidence_dir"
server_pid=
cleanup() {
  local status=$? failed=0
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  cp "$PERF_LAB_SOCKET/schema-inventory.json" "$evidence_dir/schema-inventory.json" || failed=1
  cp "$PERF_LAB_FIXTURES" "$evidence_dir/fixtures.json" || failed=1
  cp "$PERF_LAB_SOCKET/server.log" "$evidence_dir/private-pg-before-helper-shutdown.log" || failed=1
  if [[ "$failed" != 0 ]];then printf '%s\n' COMPILE_EVIDENCE_COPY_FAILED >&2;status=1;fi
  trap - EXIT
  if [[ "$failed" != 0 ]];then status=1;fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
snapshot=$(node "$harness/perf/create-lab-snapshot.mjs")
printf '%s\n' "$snapshot" > /tmp/foremanhq-wizard-fastlane-compiled-snapshot
export PERF_FASTLANE_SNAPSHOT="$snapshot"
node --input-type=module <<'JS'
import fs from 'node:fs';import path from 'node:path';
const s=process.env.PERF_FASTLANE_SNAPSHOT,e=JSON.parse(fs.readFileSync(path.join(s,'source-evidence.json')));
if(!s.startsWith('/tmp/foremanhq-speed-app-')||!fs.existsSync(path.join(s,'PERF_LAB_ONLY'))||e.sourceBuild!==process.env.PERF_EXPECTED_SOURCE_BUILD||e.sourceFingerprint!=='34f0c1508584e40382ad25955b3aa2b5703bdd78ced4e6ef2536e902fd82281d'||e.sourceFileCount!==2200||e.sourceVerification.unchangedFilesChecked!==2195)throw Error('Wrong wizard fastlane snapshot');
fs.writeFileSync('/tmp/foremanhq-wizard-fastlane-compile-source-before.json',JSON.stringify(e,null,2));
JS
cd "$snapshot"
./node_modules/.bin/next build --webpack > /tmp/foremanhq-wizard-fastlane-lab-build.log 2>&1 || { tail -70 /tmp/foremanhq-wizard-fastlane-lab-build.log;exit 1; }
node --input-type=module <<'JS'
import fs from 'node:fs';import path from 'node:path';import{pathToFileURL}from'node:url';
const{sourceEvidence}=await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));const s=process.env.PERF_FASTLANE_SNAPSHOT;const e=await sourceEvidence(process.env.PERF_SOURCE_ROOT,s,process.env.PERF_EXPECTED_SOURCE_BUILD,'after-lab-transforms');if(e.sourceFingerprint!=='34f0c1508584e40382ad25955b3aa2b5703bdd78ced4e6ef2536e902fd82281d')throw Error('Source changed during compile');
fs.writeFileSync('/tmp/foremanhq-wizard-fastlane-lab-compiled.json',JSON.stringify({snapshot:s,labBuild:fs.readFileSync(path.join(s,'.next/BUILD_ID'),'utf8').trim(),source:e,compileOnly:true,serverStarted:false},null,2));
JS

# Source-bound, fixture-only startup/read preflight after this private compile.
export PERF_FIXTURES="$snapshot/perf/fixtures.json" PERF_BUILD=$(cat "$snapshot/.next/BUILD_ID")
export PERF_LOG_DIR="$snapshot/data/performance-compile-preflight"
./node_modules/.bin/next start --hostname 127.0.0.1 --port 3483 > /tmp/foremanhq-wizard-fastlane-compile-preflight-server.log 2>&1 &
server_pid=$!
printf '%s\n' "$server_pid" > "$evidence_dir/server.pid"
for attempt in $(seq 1 90);do
  if curl -fsS http://127.0.0.1:3483/api/perf-lab >/dev/null 2>&1;then break;fi
  kill -0 "$server_pid" 2>/dev/null || exit 1
  sleep 1
done
PERF_BASE_URL=http://127.0.0.1:3483 node "$harness/perf/preflight.mjs"
cp "$snapshot/preflight.json" "$evidence_dir/preflight.json"
cp "$snapshot/source-evidence.json" "$evidence_dir/source-evidence.json"
cp /tmp/foremanhq-wizard-fastlane-compile-preflight-server.log "$evidence_dir/server.log"

node --input-type=module <<'JS'
import fs from'node:fs';const file='/tmp/foremanhq-wizard-fastlane-lab-compiled.json';const data=JSON.parse(fs.readFileSync(file));const preflight=JSON.parse(fs.readFileSync(process.env.PERF_FASTLANE_SNAPSHOT+'/preflight.json'));if(preflight.status!=='passed'||preflight.build!==data.labBuild||preflight.sourceBuild!==process.env.PERF_EXPECTED_SOURCE_BUILD)throw Error('Compile preflight binding failed');fs.writeFileSync(file,JSON.stringify({...data,compileOnly:false,serverStarted:true,serverPreflightCompleted:true,preflightQueryCount:preflight.results.length},null,2)+'\n');
JS
