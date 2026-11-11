#!/usr/bin/env bash
set -euo pipefail
harness=/tmp/foremanhq-perf-method-f9bHR6
method=/tmp/foremanhq-preference-functional-v6-method-emaxl6zm
owner=
cleanup(){
 local status=$? owner_status=0 forced=0
 local original_status=$status
 trap - EXIT
 if [[ -f /tmp/foremanhq-r18-pref-v6-server.pid ]];then
  server=$(cat /tmp/foremanhq-r18-pref-v6-server.pid)
  if [[ "$server" =~ ^[0-9]+$ ]];then kill -TERM "$server" 2>/dev/null || true;fi
 fi
 if [[ -n "$owner" ]];then
  # Let the server EXIT trap copy THIS-run evidence before DB helper EXIT deletes PG.
  for attempt in $(seq 1 150);do kill -0 "$owner" 2>/dev/null || break;sleep 0.1;done
  if kill -0 "$owner" 2>/dev/null;then forced=1;kill -TERM "$owner" 2>/dev/null || true;fi
  wait "$owner" || owner_status=$?
  if [[ "$forced" == 1 || ( "$owner_status" != 0 && "$owner_status" != 143 ) ]];then status=1;fi
 fi
 printf '{"inputExitCode":%s,"ownerExitCode":%s,"forcedOwnerStop":%s,"finalExitCode":%s}\n' "$original_status" "$owner_status" "$forced" "$status" > /tmp/foremanhq-r18-pref-v6-evidence/owner-cleanup.json || status=1
 exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
[[ ! -e /tmp/foremanhq-r18-pref-v6-evidence ]]
mkdir -m 700 /tmp/foremanhq-r18-pref-v6-evidence
[[ ! -e /tmp/foremanhq-r18-pref-v6-ready && ! -e /tmp/foremanhq-r18-pref-v6-config.json && ! -e /tmp/foremanhq-r18-pref-v6-functional-report.json ]] || { echo "Refusing to overwrite a prior functional attempt";exit 1; }
PERF_HARNESS_DIR="$harness" PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r18-20261111 PERF_SOURCE_BUILD_DIST=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r18-20261111/.next-web PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq PERF_PG_ERROR_REPORT=/tmp/foremanhq-r18-pref-v6-pg-errors.json timeout --signal=TERM --kill-after=20s 460s bash "$harness/perf/lab/database.sh" bash /tmp/foremanhq-r18-pref-v6-server.sh > /tmp/foremanhq-r18-pref-v6-setup.log 2>&1 &
owner=$!
for attempt in $(seq 1 120);do
 [[ -f /tmp/foremanhq-r18-pref-v6-ready ]] && break
 kill -0 "$owner" 2>/dev/null || { tail -15 /tmp/foremanhq-r18-pref-v6-setup.log;exit 1; }
 sleep 1
done
[[ -f /tmp/foremanhq-r18-pref-v6-ready ]]
node --input-type=module <<'JS'
import fs from'node:fs';import{createHash}from'node:crypto';
const frozen=JSON.parse(fs.readFileSync('/home/tim/.openclaw/workspace/kublai/perf/artifacts/compiled-preferences-functional-v6-freeze-2026-11-11.json'));for(const[file,hash]of Object.entries(frozen.files)){if(createHash('sha256').update(fs.readFileSync(frozen.methodRoot+'/'+file)).digest('hex')!==hash)throw Error('Frozen protocol changed');}const config='/tmp/foremanhq-r18-pref-v6-config.json';fs.writeFileSync('/tmp/foremanhq-r18-pref-v6-config-before.json',JSON.stringify({sealedAt:new Date().toISOString(),sha256:createHash('sha256').update(fs.readFileSync(config)).digest('hex')},null,2));fs.chmodSync(config,0o444);
JS
node "$method/perf/live/compiled-preferences-functional.mjs" /tmp/foremanhq-r18-pref-v6-config.json
