#!/usr/bin/env bash
set -euo pipefail
harness=${PERF_HARNESS_DIR:?}
snapshot=$(node -e "console.log(require('/tmp/foremanhq-r18-lab-compiled.json').snapshot)")
export PERF_R18_SNAPSHOT="$snapshot"
evidence_dir=/tmp/foremanhq-r18-pref-v6-evidence
server_pid=
preserve_evidence() {
  local failed=0
  [[ "$evidence_dir" == /tmp/foremanhq-r18-pref-v6-evidence ]] || return 1
  [[ "${PERF_LAB_SOCKET:-}" == /tmp/foremanhq-perf-pg.* ]] || return 1
  cp "$PERF_LAB_SOCKET/schema-inventory.json" "$evidence_dir/schema-inventory.json" || failed=1
  cp "$PERF_LAB_SOCKET/server.log" "$evidence_dir/private-pg-before-helper-shutdown.log" || failed=1
  cp "$PERF_LAB_FIXTURES" "$evidence_dir/fixtures.json" || failed=1
  for name in preflight source config config-before functional-report;do
    if [[ -f "/tmp/foremanhq-r18-pref-v6-$name.json" ]];then
      cp "/tmp/foremanhq-r18-pref-v6-$name.json" "$evidence_dir/$name.json" || failed=1
    fi
  done
  cp "$snapshot/source-evidence.json" "$evidence_dir/source-evidence-before.json" || failed=1
  node /tmp/foremanhq-r18-functional-source-after.mjs || failed=1
  return "$failed"
}
cleanup() {
  local status=$? copy_failed=0
  local original_status=$status
  trap - EXIT
  if [[ -n "$server_pid" ]];then kill "$server_pid" 2>/dev/null || true;wait "$server_pid" 2>/dev/null || true;fi
  preserve_evidence || { printf '%s\n' FUNCTIONAL_EVIDENCE_COPY_FAILED >&2;copy_failed=1;status=1; }
  printf '{"inputExitCode":%s,"evidenceCopyFailed":%s,"finalExitCode":%s}\n' "$original_status" "$copy_failed" "$status" > "$evidence_dir/server-cleanup.json" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node --input-type=module <<'JS'
import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';import{execFileSync}from'node:child_process';
const target=process.env.PERF_R18_SNAPSHOT,metadata=JSON.parse(fs.readFileSync('/tmp/foremanhq-r18-lab-compiled.json'));if(!target.startsWith('/tmp/foremanhq-speed-app-')||!fs.existsSync(path.join(target,'PERF_LAB_ONLY'))||fs.readFileSync(path.join(target,'.next/BUILD_ID'),'utf8').trim()!==metadata.labBuild)throw Error('Marked exact compiled R18 required');
const {sourceEvidence}=await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));const evidence=await sourceEvidence(process.env.PERF_SOURCE_ROOT,target,'c58613f12a7ae0590934ecdb15ddbc7a39e3a2f587f26d5f98792c92a4de64e8','after-lab-transforms');if(evidence.sourceFingerprint!=='ec149c2ed24935019cae5150c928b9af6606d8c41c8eba552d2a9185cf1b05dd'||evidence.sourceFileCount!==2317)throw Error('Wrong R18 source fingerprint');
const socket=process.env.PERF_LAB_SOCKET;if(!socket?.startsWith('/tmp/foremanhq-perf-pg.')||!fs.existsSync(socket+'/.s.PGSQL.55463'))throw Error('Fresh private socket required');const fixtures=JSON.parse(fs.readFileSync(process.env.PERF_LAB_FIXTURES));if(fixtures.provenance!=='isolated-seeded-app'||fixtures.productionDatabase!==false)throw Error('Synthetic fixture required');
fs.copyFileSync(process.env.PERF_LAB_FIXTURES,path.join(target,'perf/fixtures.json'));fs.rmSync(path.join(target,'uploads'),{recursive:true,force:true});execFileSync('rsync',['-a',process.env.PERF_LAB_ASSETS+'/',target+'/']);
fs.copyFileSync(process.env.PERF_LAB_FIXTURES,'/tmp/foremanhq-r18-pref-v6-fixtures.json');fs.copyFileSync(socket+'/schema-inventory.json','/tmp/foremanhq-r18-pref-v6-schema-inventory.json');fs.writeFileSync('/tmp/foremanhq-r18-pref-v6-source.json',JSON.stringify({...evidence,labBuild:metadata.labBuild,snapshot:target,socket},null,2));
JS
export FOREMANHQ_BACKGROUND_MODE=separate BIM_WORKER_DISABLED=1 SKIP_ENV_VALIDATION=1
export CLERK_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_speed_lab_only
export STRIPE_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_speed_lab_only
export PERF_LOG_DIR="$snapshot/data/performance-functional" PERF_FIXTURES="$snapshot/perf/fixtures.json"
export PERF_BUILD=$(cat "$snapshot/.next/BUILD_ID")
unset NEXT_DIST_DIR NEXT_TSCONFIG_PATH FOREMANHQ_RUNTIME_DIR FOREMANHQ_PUBLIC_DIR
cd "$snapshot"
./node_modules/.bin/next start --hostname 127.0.0.1 --port 3483 > /tmp/foremanhq-r18-pref-v6-server.log 2>&1 &
server_pid=$!
printf '%s\n' "$server_pid" > /tmp/foremanhq-r18-pref-v6-server.pid
for attempt in $(seq 1 90);do
 if curl -fsS http://127.0.0.1:3483/api/perf-lab >/dev/null 2>&1;then break;fi
 kill -0 "$server_pid" 2>/dev/null || exit 1
 sleep 1
done
PERF_BASE_URL=http://127.0.0.1:3483 node "$harness/perf/preflight.mjs"
cp "$snapshot/preflight.json" /tmp/foremanhq-r18-pref-v6-preflight.json
node --input-type=module <<'JS'
import fs from'node:fs';const metadata=JSON.parse(fs.readFileSync('/tmp/foremanhq-r18-lab-compiled.json'));const config={backend:'http://127.0.0.1:3483/',proxy:'http://127.0.0.1:3484/',snapshot:metadata.snapshot,sourceEvidence:metadata.snapshot+'/source-evidence.json',fixtures:metadata.snapshot+'/perf/fixtures.json',preflight:'/tmp/foremanhq-r18-pref-v6-preflight.json',serverPid:'/tmp/foremanhq-r18-pref-v6-server.pid',serverLog:'/tmp/foremanhq-r18-pref-v6-server.log',expectedSourceBuild:'c58613f12a7ae0590934ecdb15ddbc7a39e3a2f587f26d5f98792c92a4de64e8',expectedSourceFingerprint:'ec149c2ed24935019cae5150c928b9af6606d8c41c8eba552d2a9185cf1b05dd',expectedLabBuild:metadata.labBuild,output:'/tmp/foremanhq-r18-pref-v6-functional-report.json'};fs.writeFileSync('/tmp/foremanhq-r18-pref-v6-config.json',JSON.stringify(config,null,2));
JS
touch /tmp/foremanhq-r18-pref-v6-ready
printf '%s\n' R18_PREFERENCE_FIXTURE_READY
wait "$server_pid"
