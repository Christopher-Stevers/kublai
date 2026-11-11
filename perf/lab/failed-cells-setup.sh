#!/usr/bin/env bash
# SOURCE-ONLY PROPOSAL. Root must review frozen hashes and authorize a quiet slot.
# Outer invocation: reviewed owned-process-supervisor.py run --seconds 480 --record OWNED_OUTER_RECORD -- bash THIS_FILE
set -euo pipefail
method=${PERF_FAILED_CELLS_METHOD_ROOT:?Reviewed frozen diagnostic method required}
[[ "$method" == /tmp/foremanhq-failed-cells-method.* ]]
export PERF_FAILED_CELLS_METHOD_ROOT="$method"
export PERF_HARNESS_DIR=/tmp/foremanhq-perf-method-f9bHR6
export PERF_SHEET_PROTOCOL=ready-then-pinch-v2
root=/tmp/foremanhq-failed-cells-v1-attempt1
[[ ! -e "$root" ]]
# No subprocess/DB/browser before verifying exact method files.
node --input-type=module - "$method" <<'JS'
import fs from 'node:fs';import{createHash}from'node:crypto';import path from'node:path';import{pathToFileURL}from'node:url';
const root=process.argv[2],manifest=JSON.parse(fs.readFileSync(path.join(root,'METHOD.json')));
if(manifest.protocol!=='failed-cells-cpu-diagnostic-v1')throw Error('Wrong supplemental method');
const required=['perf/failed-cells-diagnostic.mjs','perf/failed-cells-observation.mjs','perf/lab/failed-cells-item-preflight.mjs','perf/lab/failed-cells-reuse.mjs','perf/lab/failed-cells-server.sh','perf/lab/failed-cells-setup.sh','perf/lab/failed-cells-finalize.mjs','perf/lab/failed-cells-storage.mjs','perf/lab/owned-process-supervisor.py'];
if(JSON.stringify(Object.keys(manifest.files).sort())!==JSON.stringify(required.sort())||createHash('sha256').update(fs.readFileSync(path.join(root,'METHOD.json'))).digest('hex')!==process.env.PERF_FAILED_CELLS_METHOD_SHA256)throw Error('Reviewed method file set/hash mismatch');
const{verifyFrozenHarness}=await import(pathToFileURL('/tmp/foremanhq-perf-method-f9bHR6/perf/harness-fingerprint.mjs'));
const frozen=await verifyFrozenHarness('/tmp/foremanhq-perf-method-f9bHR6');if(frozen.harnessFingerprint!=='25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4')throw Error('Frozen f9 method changed');
for(const[file,expected]of Object.entries(manifest.files)){if(file.startsWith('/')||file.split('/').includes('..')||createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')!==expected)throw Error('Supplemental method changed');}
JS
mkdir -m 700 "$root"
mkdir -m 700 "$root/baseline" "$root/candidate" "$root/captures"
cp "$method/METHOD.json" "$root/method-before.json"
owners=()
cleanup() {
 local status=$? owner_status=0 forced=0
 local original_status=$status
 trap - EXIT
 rm -rf -- "$root/owned-quota-probe" || status=1
 for role in baseline candidate;do
  if [[ -f "$root/$role/server.pid" ]];then
   server=$(cat "$root/$role/server.pid")
   if [[ "$server" =~ ^[0-9]+$ ]];then python3 "$method/perf/lab/owned-process-supervisor.py" stop --record "$root/$role/next-processes.json" || status=1;fi
  fi
 done
 for owner in "${owners[@]}";do
  forced=0;owner_status=0
  for attempt in $(seq 1 150);do kill -0 "$owner" 2>/dev/null || break;sleep 0.1;done
  if kill -0 "$owner" 2>/dev/null;then
   forced=1
   for role in baseline candidate;do
    python3 "$method/perf/lab/owned-process-supervisor.py" stop --record "$root/$role/pg-owner-processes.json" || status=1
   done
  fi
  wait "$owner" || owner_status=$?
  printf '{"ownerPid":%s,"exitCode":%s,"forced":%s}\n' "$owner" "$owner_status" "$forced" >> "$root/owner-cleanup.jsonl" || status=1
  if [[ "$forced" == 1 || ( "$owner_status" != 0 && "$owner_status" != 143 ) ]];then status=1;fi
 done
 node "$method/perf/lab/failed-cells-finalize.mjs" "$root" "$original_status" "$status" || status=1
 exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node "$method/perf/lab/failed-cells-storage.mjs" "$root"
for role in baseline candidate;do
 if [[ "$role" == baseline ]];then dist=.next-canonical-a;source=/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110;else dist=.next-web;source=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r19-20261111;fi
 PERF_FAILED_CELLS_ROLE="$role" PERF_FAILED_CELLS_ROLE_OUTPUT="$root/$role" PERF_SOURCE_ROOT="$source" PERF_SOURCE_BUILD_DIST="$source/$dist" PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq PERF_PG_ERROR_REPORT="$root/$role/pg-errors.json" python3 "$method/perf/lab/owned-process-supervisor.py" run --seconds 460 --record "$root/$role/pg-owner-processes.json" -- bash "$PERF_HARNESS_DIR/perf/lab/database.sh" bash "$method/perf/lab/failed-cells-server.sh" > "$root/$role/setup.log" 2>&1 &
 owners+=("$!")
done
for attempt in $(seq 1 150);do
 if [[ -f "$root/baseline/ready" && -f "$root/candidate/ready" ]];then break;fi
 for owner in "${owners[@]}";do kill -0 "$owner" 2>/dev/null || exit 1;done
 sleep 1
done
[[ -f "$root/baseline/ready" && -f "$root/candidate/ready" ]]
node --input-type=module - "$root" <<'JS'
import fs from'node:fs';import{createHash}from'node:crypto';const root=process.argv[2];
const config={attemptId:'phase0-r19-five-failed-cells-attempt1',harnessRoot:'/tmp/foremanhq-perf-method-f9bHR6',outputDirectory:root+'/captures',baseline:JSON.parse(fs.readFileSync(root+'/baseline/runtime-config.json')),candidate:JSON.parse(fs.readFileSync(root+'/candidate/runtime-config.json'))};
if(config.baseline.databaseLog===config.candidate.databaseLog)throw Error('Two distinct fresh databases required');
const bytes=JSON.stringify(config,null,2)+'\n';fs.writeFileSync(root+'/config.json',bytes,{mode:0o444});fs.writeFileSync(root+'/config-before.json',JSON.stringify({sha256:createHash('sha256').update(bytes).digest('hex'),sealedAt:new Date().toISOString()},null,2)+'\n');
JS
printf '%s\n' BOTH_PRIVATE_PREFLIGHTS_READY_STARTING_AUTHORIZED_TEN_OPERATION_DRIVER
# Independent driver supervisor; no automatic retry or eleventh operation.
python3 "$method/perf/lab/owned-process-supervisor.py" run --seconds 180 --record "$root/driver-processes.json" -- node "$method/perf/failed-cells-diagnostic.mjs" "$root/config.json" > "$root/driver.log" 2>&1
