#!/usr/bin/env bash
set -euo pipefail
harness=/tmp/foremanhq-perf-method-f9bHR6
baseline_pid= candidate_pid=
cleanup(){
 for pid in "$baseline_pid" "$candidate_pid";do if [[ -n "$pid" ]];then kill -TERM "$pid" 2>/dev/null || true;fi;done
 for pid in "$baseline_pid" "$candidate_pid";do if [[ -n "$pid" ]];then wait "$pid" 2>/dev/null || true;fi;done
}
trap cleanup EXIT INT TERM
rm -f /tmp/foremanhq-actionability-baseline-ready /tmp/foremanhq-actionability-candidate-ready
PERF_HARNESS_DIR="$harness" PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110 PERF_SOURCE_BUILD_DIST=/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110/.next-canonical-a PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq PERF_PG_ERROR_REPORT=/tmp/foremanhq-actionability-baseline-pg-errors.json timeout --signal=TERM --kill-after=20s 12m bash "$harness/perf/lab/database.sh" bash /tmp/foremanhq-actionability-baseline-server.sh > /tmp/foremanhq-actionability-baseline-setup.log 2>&1 &
baseline_pid=$!
PERF_HARNESS_DIR="$harness" PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase1-reviewed-r7-20261111 PERF_SOURCE_BUILD_DIST=/home/tim/.openclaw/workspace/releases/speed-phase1-reviewed-r7-20261111/.next-web PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-nTtbuM PERF_PG_ERROR_REPORT=/tmp/foremanhq-actionability-candidate-pg-errors.json timeout --signal=TERM --kill-after=20s 12m bash "$harness/perf/lab/database.sh" bash /tmp/foremanhq-actionability-candidate-server.sh > /tmp/foremanhq-actionability-candidate-setup.log 2>&1 &
candidate_pid=$!
for attempt in $(seq 1 120);do
 if [[ -f /tmp/foremanhq-actionability-baseline-ready && -f /tmp/foremanhq-actionability-candidate-ready ]];then break;fi
 kill -0 "$baseline_pid" 2>/dev/null && kill -0 "$candidate_pid" 2>/dev/null || { printf '%s\n' 'Private fixture setup failed';exit 1; }
 sleep 1
done
[[ -f /tmp/foremanhq-actionability-baseline-ready && -f /tmp/foremanhq-actionability-candidate-ready ]]
node --input-type=module <<'JS'
import fs from'node:fs';const config={harnessRoot:'/tmp/foremanhq-perf-method-f9bHR6'};
for(const[role,snapshot,port]of[['baseline','/tmp/foremanhq-speed-app-5h2kmq',3482],['candidate','/tmp/foremanhq-speed-app-nTtbuM',3483]]){const source=JSON.parse(fs.readFileSync(`/tmp/foremanhq-actionability-${role}-source.json`));config[role]={base:`http://127.0.0.1:${port}/`,fixtures:snapshot+'/perf/fixtures.json',sourceEvidence:snapshot+'/source-evidence.json',preflight:`/tmp/foremanhq-actionability-${role}-preflight.json`,databaseLog:source.socket+'/server.log',expectedSourceBuild:source.sourceBuild,expectedSourceFingerprint:source.sourceFingerprint,expectedLabBuild:source.labBuild};}
if(config.baseline.expectedSourceBuild!=='c25f525d3a4755145e22b9977b300607209034ff59196ee170cbe219cf2c2e5d'||config.candidate.expectedSourceBuild!=='754be902243877741d07e73a3fd492261afaf7dc0a3cdf07e859a85c9ad5b2d4')throw Error('Wrong source pair');
fs.writeFileSync('/tmp/foremanhq-actionability-config.json',JSON.stringify(config,null,2));
JS
method=$(cat /tmp/foremanhq-actionability-method)
PERF_DIAGNOSTIC_OUTPUT=/tmp/foremanhq-actionability-diagnostic.json node "$method/perf/openjob-actionability-diagnostic.mjs" /tmp/foremanhq-actionability-config.json
