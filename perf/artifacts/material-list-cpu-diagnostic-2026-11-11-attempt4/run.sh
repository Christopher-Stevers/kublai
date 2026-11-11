#!/usr/bin/env bash
set -euo pipefail
harness=/tmp/foremanhq-perf-method-f9bHR6
baseline_pid= candidate_pid=
cleanup(){
 for pid in "$baseline_pid" "$candidate_pid";do if [[ -n "$pid" ]];then kill -TERM "$pid" 2>/dev/null || true;fi;done
 for pid in "$baseline_pid" "$candidate_pid";do if [[ -n "$pid" ]];then wait "$pid" 2>/dev/null || true;fi;done
}
trap cleanup EXIT INT TERM
rm -f /tmp/foremanhq-material-cpu-a4-baseline-ready /tmp/foremanhq-material-cpu-a4-candidate-ready
PERF_HARNESS_DIR="$harness" PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110 PERF_SOURCE_BUILD_DIST=/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110/.next-canonical-a PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq PERF_PG_ERROR_REPORT=/tmp/foremanhq-material-cpu-a4-baseline-pg-errors.json timeout --signal=TERM --kill-after=20s 7m bash "$harness/perf/lab/database.sh" bash /tmp/foremanhq-material-cpu-a4-baseline-server.sh > /tmp/foremanhq-material-cpu-a4-baseline-setup.log 2>&1 &
baseline_pid=$!
PERF_HARNESS_DIR="$harness" PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase1-reviewed-r6-20261111 PERF_SOURCE_BUILD_DIST=/home/tim/.openclaw/workspace/releases/speed-phase1-reviewed-r6-20261111/.next-web PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-eNPXZh PERF_PG_ERROR_REPORT=/tmp/foremanhq-material-cpu-a4-candidate-pg-errors.json timeout --signal=TERM --kill-after=20s 7m bash "$harness/perf/lab/database.sh" bash /tmp/foremanhq-material-cpu-a4-candidate-server.sh > /tmp/foremanhq-material-cpu-a4-candidate-setup.log 2>&1 &
candidate_pid=$!
for attempt in $(seq 1 120);do
 if [[ -f /tmp/foremanhq-material-cpu-a4-baseline-ready && -f /tmp/foremanhq-material-cpu-a4-candidate-ready ]];then break;fi
 kill -0 "$baseline_pid" 2>/dev/null && kill -0 "$candidate_pid" 2>/dev/null || { printf '%s\n' 'Private fixture setup failed';exit 1; }
 sleep 1
done
[[ -f /tmp/foremanhq-material-cpu-a4-baseline-ready && -f /tmp/foremanhq-material-cpu-a4-candidate-ready ]]
node --input-type=module <<'JS'
import fs from'node:fs';const config={harnessRoot:'/tmp/foremanhq-perf-method-f9bHR6'};
for(const[role,snapshot,port]of[['baseline','/tmp/foremanhq-speed-app-5h2kmq',3482],['candidate','/tmp/foremanhq-speed-app-eNPXZh',3483]]){const source=JSON.parse(fs.readFileSync(`/tmp/foremanhq-material-cpu-a4-${role}-source.json`));config[role]={base:`http://127.0.0.1:${port}/`,fixtures:snapshot+'/perf/fixtures.json',sourceEvidence:snapshot+'/source-evidence.json',preflight:`/tmp/foremanhq-material-cpu-a4-${role}-preflight.json`,databaseLog:source.socket+'/server.log',expectedSourceBuild:source.sourceBuild,expectedSourceFingerprint:source.sourceFingerprint,expectedLabBuild:source.labBuild};}
if(config.baseline.expectedSourceBuild!=='c25f525d3a4755145e22b9977b300607209034ff59196ee170cbe219cf2c2e5d'||config.candidate.expectedSourceBuild!=='c49e8cbad84665aadc57323448c013f7c2420fa9cdff3992835164913bb7f161')throw Error('Wrong source pair');
fs.writeFileSync('/tmp/foremanhq-material-cpu-a4-config.json',JSON.stringify(config,null,2));
JS
node --input-type=module <<'JS'
import fs from 'node:fs';
const file='/tmp/foremanhq-material-cpu-a4-config.json';const config=JSON.parse(fs.readFileSync(file));config.outputDirectory='/tmp/foremanhq-material-cpu-a4-output';config.attemptId='attempt4-reviewed-synthetic-bootstrap-v4';
for(const role of ['baseline','candidate']){config[role].snapshot=role==='baseline'?'/tmp/foremanhq-speed-app-5h2kmq':'/tmp/foremanhq-speed-app-eNPXZh';config[role].serverPid=`/tmp/foremanhq-material-cpu-a4-${role}-server.pid`;}
fs.writeFileSync(file,JSON.stringify(config,null,2));
JS
printf '%s\n' MATERIAL_CPU_SETUP_READY
for attempt in $(seq 1 180);do [[ -f /tmp/foremanhq-material-cpu-a4-GO ]] && break;sleep 1;done
[[ -f /tmp/foremanhq-material-cpu-a4-GO ]]
node /tmp/foremanhq-material-cpu-a4-method/perf/material-list-cpu-diagnostic.mjs /tmp/foremanhq-material-cpu-a4-config.json
