#!/usr/bin/env bash
set -euo pipefail
harness=/tmp/foremanhq-perf-method-f9bHR6
method=/tmp/foremanhq-preference-functional-v4-method-wAQrlg
owner=
cleanup(){
 if [[ -f /tmp/foremanhq-r14-pref-v4-server.pid ]];then
  server=$(cat /tmp/foremanhq-r14-pref-v4-server.pid)
  if [[ "$server" =~ ^[0-9]+$ ]];then kill -TERM "$server" 2>/dev/null || true;fi
 fi
 if [[ -n "$owner" ]];then kill -TERM "$owner" 2>/dev/null || true;wait "$owner" 2>/dev/null || true;fi
}
trap cleanup EXIT INT TERM
[[ ! -e /tmp/foremanhq-r14-pref-v4-ready && ! -e /tmp/foremanhq-r14-pref-v4-config.json && ! -e /tmp/foremanhq-r14-pref-v4-functional-report.json ]] || { echo "Refusing to overwrite a prior functional attempt";exit 1; }
PERF_HARNESS_DIR="$harness" PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase1-native-r14-20261111 PERF_SOURCE_BUILD_DIST=/home/tim/.openclaw/workspace/releases/speed-phase1-native-r14-20261111/.next-web PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq PERF_PG_ERROR_REPORT=/tmp/foremanhq-r14-pref-v4-pg-errors.json timeout --signal=TERM --kill-after=20s 460s bash "$harness/perf/lab/database.sh" bash /tmp/foremanhq-r14-pref-v4-server.sh > /tmp/foremanhq-r14-pref-v4-setup.log 2>&1 &
owner=$!
for attempt in $(seq 1 120);do
 [[ -f /tmp/foremanhq-r14-pref-v4-ready ]] && break
 kill -0 "$owner" 2>/dev/null || { tail -15 /tmp/foremanhq-r14-pref-v4-setup.log;exit 1; }
 sleep 1
done
[[ -f /tmp/foremanhq-r14-pref-v4-ready ]]
node --input-type=module <<'JS'
import fs from'node:fs';import{createHash}from'node:crypto';
const frozen=JSON.parse(fs.readFileSync('/home/tim/.openclaw/workspace/kublai/perf/artifacts/compiled-preferences-functional-v4-freeze-2026-11-11.json'));for(const[file,hash]of Object.entries(frozen.files)){if(createHash('sha256').update(fs.readFileSync(frozen.methodRoot+'/'+file)).digest('hex')!==hash)throw Error('Frozen protocol changed');}const config='/tmp/foremanhq-r14-pref-v4-config.json';fs.writeFileSync('/tmp/foremanhq-r14-pref-v4-config-before.json',JSON.stringify({sealedAt:new Date().toISOString(),sha256:createHash('sha256').update(fs.readFileSync(config)).digest('hex')},null,2));fs.chmodSync(config,0o444);
JS
node "$method/perf/live/compiled-preferences-functional.mjs" /tmp/foremanhq-r14-pref-v4-config.json
