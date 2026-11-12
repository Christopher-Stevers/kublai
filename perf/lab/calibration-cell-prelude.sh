#!/usr/bin/env bash
# Owned synthetic fixture scheduling only; no timer surrounds this script.
set -euo pipefail
harness=${PERF_HARNESS_DIR:?}
stage=${PERF_STAGE_EVIDENCE_DIR:?}
snapshot=${PERF_REUSE_SNAPSHOT:?}
[[ "$stage" == /tmp/foremanhq-calibration15-* && "$stage" != *..* && "$snapshot" == /tmp/foremanhq-speed-app-fxHxrn ]]
[[ -f "$snapshot/PERF_LAB_ONLY" && "${PERF_LAB_SOCKET:?}" == /tmp/foremanhq-perf-pg.* ]]
pid_file="$stage/server.pid"
stop_server(){
 if [[ -f "$stage/active-next-record" ]];then
  local record;record=$(cat "$stage/active-next-record")
  [[ "$record" == "$stage"/cells/*/next-processes.json && "$record" != *..* ]] || return 1
  python3 "$harness/perf/lab/owned-process-supervisor.py" stop --record "$record" || return 1
  node --input-type=module - "$record" "$stage/last-drain.json" <<'JS'
import fs from'node:fs';const file=process.argv[2];let record;for(let i=0;i<100;i++){record=JSON.parse(fs.readFileSync(file));if(record.status==='stopped'&&record.familyAbsent&&record.ownedIdentitiesAbsent)break;await new Promise(r=>setTimeout(r,100));}if(record.status!=='stopped'||!record.familyAbsent||!record.ownedIdentitiesAbsent||record.timedOut)throw Error('Owned Next family did not stop');for(const p of record.processes){try{const text=fs.readFileSync('/proc/'+p.pid+'/stat','utf8'),start=text.slice(text.lastIndexOf(')')+1).trim().split(/\s+/)[19];if(start===p.startTime)throw Error('Recorded owned child still present');}catch(e){if(e.code!=='ENOENT')throw e;}}fs.writeFileSync(process.argv[3],JSON.stringify({priorServerPid:record.root?.pid??null,priorServerAbsent:true,priorFamilyAbsent:true,priorRecord:file})+'\n');
JS
  [[ "$?" == 0 ]] || return 1
  rm -f -- "$pid_file" "$stage/active-next-record"
 else
  printf '{"priorServerPid":null,"priorServerAbsent":true,"priorFamilyAbsent":true}\n' > "$stage/last-drain.json"
 fi
}
stop_server
[[ "${1:-prepare}" != stop ]] || exit 0
cell="${PERF_CELL_LINK:-initial}-${PERF_CELL_JOURNEY:-initial}"
if [[ "${1:-prepare}" == initial ]];then cell=initial;else
[[ "$cell" =~ ^(Basement|Site|Office)-(coldstart|openjob|switchjobtabs|openmateriallist|changeqty|receiveline|opensheetpinch|sendchat)$ ]]
fi
out="$stage/cells/$cell"
[[ ! -e "$out" ]];mkdir -m 700 -p "$out"
failed_cleanup(){ local status=$?;trap - EXIT;if [[ "$status" != 0 ]];then stop_server || status=1;fi;exit "$status"; }
trap failed_cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
cp "$stage/last-drain.json" "$out/drain.json"
node "$harness/perf/lab/calibration-state.mjs" restore > "$out/restore.json" 2> "$out/restore.stderr"
node "$harness/perf/lab/reset-writes.mjs" > "$out/reset.log" 2>&1
node "$harness/perf/lab/calibration-state.mjs" verify > "$out/state.json"
export FOREMANHQ_BACKGROUND_MODE=separate BIM_WORKER_DISABLED=1 SKIP_ENV_VALIDATION=1
export CLERK_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_speed_lab_only
export STRIPE_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_speed_lab_only
export NEXT_PUBLIC_BUILD_ID=isolated-speed-baseline PORT=3481
unset NEXT_DIST_DIR NEXT_TSCONFIG_PATH FOREMANHQ_RUNTIME_DIR FOREMANHQ_PUBLIC_DIR
cd "$snapshot"
printf '%s\n' "$out/next-processes.json" > "$stage/active-next-record"
python3 "$harness/perf/lab/owned-process-supervisor.py" run --seconds 4500 --record "$out/next-processes.json" --pid-file "$pid_file" -- ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3481 > "$out/server.log" 2>&1 < /dev/null &
printf '%s\n' "$!" > "$out/next-owner.pid"
for i in $(seq 1 50);do [[ -f "$pid_file" ]] && break;sleep .1;done
[[ -f "$pid_file" ]]
node --input-type=module - "$pid_file" "$out/server.identity.json" <<'JS'
import fs from'node:fs';const pid=fs.readFileSync(process.argv[2],'utf8').trim(),text=fs.readFileSync('/proc/'+pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+1).trim().split(/\s+/);fs.writeFileSync(process.argv[3],JSON.stringify({pid:Number(pid),startTime:fields[19]})+'\n');
JS
cp "$out/server.identity.json" "$stage/server.identity.json"
for i in $(seq 1 120);do
 if curl -fsS http://127.0.0.1:3481/api/perf-lab >/dev/null 2>&1;then break;fi
 kill -0 "$(cat "$pid_file")" 2>/dev/null || exit 1
 sleep .1
done
PERF_BASE_URL=http://127.0.0.1:3481 node "$harness/perf/preflight.mjs" > "$out/preflight.log" 2>&1
cp "$snapshot/preflight.json" "$out/preflight.json"
node --input-type=module - "$out" <<'JS'
import fs from'node:fs';import{createHash}from'node:crypto';const dir=process.argv[2],state=JSON.parse(fs.readFileSync(dir+'/state.json')),plan=JSON.parse(fs.readFileSync(process.env.PERF_CAPTURE_PLAN)),preflight=JSON.parse(fs.readFileSync(dir+'/preflight.json'));if(preflight.status!=='passed'||preflight.results.length!==14||preflight.sourceBuild!==plan.sourceBuild||preflight.sourceFingerprint!==plan.sourceFingerprint||preflight.build!==plan.build)throw Error('Per-cell read preflight failed');const resetHelperSha256=createHash('sha256').update(fs.readFileSync(process.env.PERF_HARNESS_DIR+'/perf/lab/reset-writes.mjs')).digest('hex');if(resetHelperSha256!==plan.fixturePrelude.resetHelperSha256)throw Error('Pinned reset helper differs');const drain=JSON.parse(fs.readFileSync(dir+'/drain.json')),restore=JSON.parse(fs.readFileSync(dir+'/restore.json'));if(!drain.priorServerAbsent||restore.seedSnapshotSha256!==state.seedSnapshotSha256||restore.privateDatabase.socket!==state.privateDatabase.socket)throw Error('Restore/drain proof differs');const certificate={status:'passed',...state,fixturePrelude:plan.fixturePrelude,sourceBuild:plan.sourceBuild,journey:process.env.PERF_CELL_JOURNEY,link:process.env.PERF_CELL_LINK,resetHelperSha256,resetCompleted:true,restoreCompleted:true,readPreflightCount:14,serverIdentity:JSON.parse(fs.readFileSync(dir+'/server.identity.json')),drain,preflightSha256:createHash('sha256').update(fs.readFileSync(dir+'/preflight.json')).digest('hex'),observedAt:new Date().toISOString()};fs.writeFileSync(dir+'/certificate.json',JSON.stringify(certificate,null,2)+'\n');console.log(JSON.stringify(certificate));
JS
