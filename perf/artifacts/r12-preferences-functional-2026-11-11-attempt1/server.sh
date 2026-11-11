#!/usr/bin/env bash
set -euo pipefail
harness=${PERF_HARNESS_DIR:?}
snapshot=$(node -e "console.log(require('/tmp/foremanhq-r12-lab-compiled.json').snapshot)")
export PERF_R12_SNAPSHOT="$snapshot"
node --input-type=module <<'JS'
import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';import{execFileSync}from'node:child_process';
const target=process.env.PERF_R12_SNAPSHOT,metadata=JSON.parse(fs.readFileSync('/tmp/foremanhq-r12-lab-compiled.json'));if(!target.startsWith('/tmp/foremanhq-speed-app-')||!fs.existsSync(path.join(target,'PERF_LAB_ONLY'))||fs.readFileSync(path.join(target,'.next/BUILD_ID'),'utf8').trim()!==metadata.labBuild)throw Error('Marked exact compiled R12 required');
const {sourceEvidence}=await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));const evidence=await sourceEvidence(process.env.PERF_SOURCE_ROOT,target,'d18cbd7b82933e2e0dc0999ccfcf2054aa7cf095946de1a379d6b0365e8b7736','after-lab-transforms');if(evidence.sourceFingerprint!=='f8aea0644b7c7471a1bdae597535001c44a6e0a337b8ef875da68e9c24327c09'||evidence.sourceFileCount!==2308)throw Error('Wrong R12 source fingerprint');
const socket=process.env.PERF_LAB_SOCKET;if(!socket?.startsWith('/tmp/foremanhq-perf-pg.')||!fs.existsSync(socket+'/.s.PGSQL.55463'))throw Error('Fresh private socket required');const fixtures=JSON.parse(fs.readFileSync(process.env.PERF_LAB_FIXTURES));if(fixtures.provenance!=='isolated-seeded-app'||fixtures.productionDatabase!==false)throw Error('Synthetic fixture required');
fs.copyFileSync(process.env.PERF_LAB_FIXTURES,path.join(target,'perf/fixtures.json'));fs.rmSync(path.join(target,'uploads'),{recursive:true,force:true});execFileSync('rsync',['-a',process.env.PERF_LAB_ASSETS+'/',target+'/']);
fs.copyFileSync(process.env.PERF_LAB_FIXTURES,'/tmp/foremanhq-r12-preferences-fixtures.json');fs.copyFileSync(socket+'/schema-inventory.json','/tmp/foremanhq-r12-preferences-schema-inventory.json');fs.writeFileSync('/tmp/foremanhq-r12-preferences-source.json',JSON.stringify({...evidence,labBuild:metadata.labBuild,snapshot:target,socket},null,2));
JS
export FOREMANHQ_BACKGROUND_MODE=separate BIM_WORKER_DISABLED=1 SKIP_ENV_VALIDATION=1
export CLERK_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_speed_lab_only
export STRIPE_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_speed_lab_only
export PERF_LOG_DIR="$snapshot/data/performance-functional" PERF_FIXTURES="$snapshot/perf/fixtures.json"
export PERF_BUILD=$(cat "$snapshot/.next/BUILD_ID")
unset NEXT_DIST_DIR NEXT_TSCONFIG_PATH FOREMANHQ_RUNTIME_DIR FOREMANHQ_PUBLIC_DIR
cd "$snapshot"
./node_modules/.bin/next start --hostname 127.0.0.1 --port 3483 > /tmp/foremanhq-r12-preferences-server.log 2>&1 &
server_pid=$!
cleanup(){ kill "$server_pid" 2>/dev/null || true;wait "$server_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
printf '%s\n' "$server_pid" > /tmp/foremanhq-r12-preferences-server.pid
for attempt in $(seq 1 90);do
 if curl -fsS http://127.0.0.1:3483/api/perf-lab >/dev/null 2>&1;then break;fi
 kill -0 "$server_pid" 2>/dev/null || exit 1
 sleep 1
done
PERF_BASE_URL=http://127.0.0.1:3483 node "$harness/perf/preflight.mjs"
cp "$snapshot/preflight.json" /tmp/foremanhq-r12-preferences-preflight.json
node --input-type=module <<'JS'
import fs from'node:fs';const metadata=JSON.parse(fs.readFileSync('/tmp/foremanhq-r12-lab-compiled.json'));const config={backend:'http://127.0.0.1:3483/',proxy:'http://127.0.0.1:3484/',snapshot:metadata.snapshot,sourceEvidence:metadata.snapshot+'/source-evidence.json',fixtures:metadata.snapshot+'/perf/fixtures.json',preflight:'/tmp/foremanhq-r12-preferences-preflight.json',serverPid:'/tmp/foremanhq-r12-preferences-server.pid',serverLog:'/tmp/foremanhq-r12-preferences-server.log',expectedSourceBuild:'d18cbd7b82933e2e0dc0999ccfcf2054aa7cf095946de1a379d6b0365e8b7736',expectedSourceFingerprint:'f8aea0644b7c7471a1bdae597535001c44a6e0a337b8ef875da68e9c24327c09',expectedLabBuild:metadata.labBuild,output:'/tmp/foremanhq-r12-preferences-functional-report.json'};fs.writeFileSync('/tmp/foremanhq-r12-preferences-config.json',JSON.stringify(config,null,2));
JS
touch /tmp/foremanhq-r12-preferences-ready
printf '%s\n' R12_PREFERENCE_FIXTURE_READY
wait "$server_pid"
