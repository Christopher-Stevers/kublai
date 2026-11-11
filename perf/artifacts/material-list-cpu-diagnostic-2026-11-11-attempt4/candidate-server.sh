#!/usr/bin/env bash
set -euo pipefail
snapshot=/tmp/foremanhq-speed-app-eNPXZh
harness_root=${PERF_HARNESS_DIR:?}
export PERF_PHONE_SNAPSHOT="$snapshot"
node --input-type=module <<'JS'
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';
const target=process.env.PERF_PHONE_SNAPSHOT, source=process.env.PERF_SOURCE_ROOT;
if(!target.startsWith('/tmp/foremanhq-speed-app-')||!fs.existsSync(path.join(target,'PERF_LAB_ONLY')))throw Error('Marked isolated artifact required');
const {sourceEvidence}=await import(pathToFileURL(path.join(process.env.PERF_HARNESS_DIR,'scripts/release/source-fingerprint.mjs')));
const build=fs.readFileSync(path.join(process.env.PERF_SOURCE_BUILD_DIST,'BUILD_ID'),'utf8').trim();
const evidence=await sourceEvidence(source,target,build,'after-lab-transforms');const prior=JSON.parse(fs.readFileSync(path.join(target,'source-evidence.json')));
if(evidence.sourceFingerprint!==prior.sourceFingerprint||evidence.sourceBuild!==prior.sourceBuild)throw Error('Frozen compiled artifact source mismatch');
const socket=new URL(process.env.PERF_LAB_DATABASE_URL).searchParams.get('host');if(!socket?.startsWith('/tmp/foremanhq-perf-pg.')||!fs.existsSync(path.join(socket,'.s.PGSQL.55463')))throw Error('Fresh private socket required');
const fixture=JSON.parse(fs.readFileSync(process.env.PERF_LAB_FIXTURES));if(fixture.provenance!=='isolated-seeded-app'||fixture.productionDatabase!==false)throw Error('Synthetic fixtures required');
fs.copyFileSync(process.env.PERF_LAB_FIXTURES,path.join(target,'perf/fixtures.json'));
fs.rmSync(path.join(target,'uploads'),{recursive:true,force:true});execFileSync('rsync',['-a',process.env.PERF_LAB_ASSETS+'/',target+'/']);
fs.writeFileSync('/tmp/foremanhq-material-cpu-a4-candidate-source.json',JSON.stringify({...evidence,labBuild:fs.readFileSync(path.join(target,'.next/BUILD_ID'),'utf8').trim(),socket,port:3483,authentication:'lab-only-stubbed-seeded-user',productionDatabase:false},null,2));
JS
cp "$PERF_LAB_FIXTURES" /tmp/foremanhq-material-cpu-a4-candidate-fixtures.json
cp "$PERF_LAB_SOCKET/schema-inventory.json" /tmp/foremanhq-material-cpu-a4-candidate-schema-inventory.json
cp "$snapshot/source-evidence.json" /tmp/foremanhq-material-cpu-a4-candidate-source-evidence.json
export FOREMANHQ_BACKGROUND_MODE=separate BIM_WORKER_DISABLED=1 SKIP_ENV_VALIDATION=1
export CLERK_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_speed_lab_only
export STRIPE_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_speed_lab_only
unset NEXT_DIST_DIR NEXT_TSCONFIG_PATH FOREMANHQ_RUNTIME_DIR FOREMANHQ_PUBLIC_DIR
export PERF_LOG_DIR="$snapshot/data/phone-perf" PERF_FIXTURES="$snapshot/perf/fixtures.json"
export PERF_BUILD
PERF_BUILD=$(cat "$snapshot/.next/BUILD_ID")
cd "$snapshot"
./node_modules/.bin/next start --hostname 127.0.0.1 --port 3483 > /tmp/foremanhq-material-cpu-a4-candidate-server.log 2>&1 &
server_pid=$!
cleanup(){ kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
printf '%s\n' "$server_pid" > /tmp/foremanhq-material-cpu-a4-candidate-server.pid
for attempt in $(seq 1 120);do
 if curl -fsS http://127.0.0.1:3483/api/perf-lab > /dev/null 2>&1;then break;fi
 if ! kill -0 "$server_pid" 2>/dev/null;then tail -10 /tmp/foremanhq-material-cpu-a4-candidate-server.log;exit 1;fi
 sleep 1
done
PERF_BASE_URL=http://127.0.0.1:3483 node "$harness_root/perf/preflight.mjs"
cp "$snapshot/preflight.json" /tmp/foremanhq-material-cpu-a4-candidate-preflight.json
touch /tmp/foremanhq-material-cpu-a4-candidate-ready
printf '%s\n' MATERIAL_CPU_FIXTURE_READY
wait "$server_pid"
