#!/usr/bin/env bash
# Supplemental only; execute solely after root reviews sealed method and quiet slot.
set -euo pipefail
method=${PERF_OFFICE_TIMELINE_METHOD_ROOT:?}
[[ "$method" == /tmp/foremanhq-office-timeline-method.* ]]
export PERF_HARNESS_DIR=/tmp/foremanhq-perf-method-f9bHR6 PERF_SHEET_PROTOCOL=ready-then-pinch-v2
root=/tmp/foremanhq-office-timeline-attempt1
[[ ! -e "$root" ]]
node --input-type=module - "$method" <<'JS'
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';const root=process.argv[2],bytes=fs.readFileSync(path.join(root,'METHOD.json')),manifest=JSON.parse(bytes);if(createHash('sha256').update(bytes).digest('hex')!==process.env.PERF_OFFICE_TIMELINE_METHOD_SHA256||manifest.protocol!=='active-office-material-timeline-v1')throw Error('Unreviewed method');for(const[file,expected]of Object.entries(manifest.files)){if(file.startsWith('/')||file.split('/').includes('..')||createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')!==expected)throw Error('Method changed');}const{verifyFrozenHarness}=await import(pathToFileURL('/tmp/foremanhq-perf-method-f9bHR6/perf/harness-fingerprint.mjs'));if((await verifyFrozenHarness('/tmp/foremanhq-perf-method-f9bHR6')).harnessFingerprint!=='25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4')throw Error('Frozen method changed');
JS
mkdir -m 700 "$root" "$root/runtime" "$root/captures"
cp "$method/METHOD.json" "$root/method-before.json"
owner=
cleanup(){
 local status=$? owner_status=0
 trap - EXIT
 if [[ -f "$root/runtime/server.pid" ]];then python3 "$method/perf/lab/owned-process-supervisor.py" stop --record "$root/runtime/next-processes.json" || status=1;fi
 if [[ -n "$owner" ]];then
  for attempt in $(seq 1 150);do kill -0 "$owner" 2>/dev/null || break;sleep 0.1;done
  if kill -0 "$owner" 2>/dev/null;then python3 "$method/perf/lab/owned-process-supervisor.py" stop --record "$root/runtime/pg-owner-processes.json" || status=1;fi
  wait "$owner" || owner_status=$?
  if [[ "$owner_status" != 0 && "$owner_status" != 143 ]];then status=1;fi
  printf '{"ownerPid":%s,"exitCode":%s}\n' "$owner" "$owner_status" > "$root/owner-cleanup.json" || status=1
 fi
 node "$method/perf/lab/office-timeline-finalize.mjs" "$root" "$status" "$status" || status=1
 exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node "$method/perf/lab/office-timeline-storage.mjs" full
cp /tmp/foremanhq-office-timeline-full-storage/storage-preflight.json "$root/storage-preflight.json"
export PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112
export PERF_SOURCE_BUILD_DIST="$PERF_SOURCE_ROOT/.next-web"
export PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq
export PERF_PG_ERROR_REPORT="$root/runtime/pg-errors.json"
export PERF_OFFICE_TIMELINE_ROLE=runtime PERF_OFFICE_TIMELINE_ROLE_OUTPUT="$root/runtime"
python3 "$method/perf/lab/owned-process-supervisor.py" run --seconds 460 --record "$root/runtime/pg-owner-processes.json" -- bash "$PERF_HARNESS_DIR/perf/lab/database.sh" bash "$method/perf/lab/office-timeline-server.sh" > "$root/runtime/setup.log" 2>&1 &
owner=$!
for attempt in $(seq 1 150);do [[ -f "$root/runtime/ready" ]] && break;kill -0 "$owner" 2>/dev/null || exit 1;sleep 1;done
[[ -f "$root/runtime/ready" ]]
node --input-type=module - "$root" <<'JS'
import fs from'node:fs';import{createHash}from'node:crypto';const root=process.argv[2];const config={attemptId:'active-office-material-timeline-attempt1',harnessRoot:'/tmp/foremanhq-perf-method-f9bHR6',outputDirectory:root+'/captures',runtime:JSON.parse(fs.readFileSync(root+'/runtime/runtime-config.json'))};const bytes=JSON.stringify(config,null,2)+'\n';fs.writeFileSync(root+'/config.json',bytes,{mode:0o444});fs.writeFileSync(root+'/config-before.json',JSON.stringify({sha256:createHash('sha256').update(bytes).digest('hex'),sealedAt:new Date().toISOString()},null,2)+'\n');
JS
python3 "$method/perf/lab/owned-process-supervisor.py" run --seconds 180 --record "$root/driver-processes.json" -- node "$method/perf/material-office-timeline.mjs" "$root/config.json" > "$root/driver.log" 2>&1
