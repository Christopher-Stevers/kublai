#!/usr/bin/env bash
# Invoked inside the new frozen database.sh owner; no production connections.
set -euo pipefail
harness=${PERF_HARNESS_DIR:?}
stage=${PERF_STAGE_EVIDENCE_DIR:?}
snapshot=${PERF_REUSE_SNAPSHOT:?}
[[ "$stage" == /tmp/foremanhq-calibration15-* && "$stage" != *..* && "$snapshot" == /tmp/foremanhq-speed-app-fxHxrn ]]
[[ "${PERF_SOURCE_ROOT:?}" == /home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112 ]]
[[ -d "$stage" && -f "$snapshot/PERF_LAB_ONLY" ]]
cleanup(){
 local status=$? failed=0 stopped=0
 trap - EXIT
 bash "$harness/perf/lab/calibration-cell-prelude.sh" stop || failed=1
 if timeout --kill-after=2s 8s "${PERF_PG_BIN:-/home/tim/.local/pgsql-18/bin}/pg_ctl" -D "$PERF_LAB_SOCKET/data" -m immediate -t 5 stop > "$stage/pg-stop.log" 2>&1 && [[ ! -f "$PERF_LAB_SOCKET/data/postmaster.pid" ]];then stopped=1;else failed=1;fi
 for name in schema-inventory.json server.log;do cp "$PERF_LAB_SOCKET/$name" "$stage/pg-$name" || failed=1;done
 cp "$PERF_LAB_FIXTURES" "$stage/fixtures.json" || failed=1
 PERF_SOURCE_PHASE=after node --input-type=module - "$snapshot" "$stage" <<'JS' || failed=1
import fs from'node:fs';import{pathToFileURL}from'node:url';const{sourceEvidence}=await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));const evidence=await sourceEvidence(process.env.PERF_SOURCE_ROOT,process.argv[2],'9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0','after-lab-transforms');if(evidence.sourceFingerprint!=='34f0c1508584e40382ad25955b3aa2b5703bdd78ced4e6ef2536e902fd82281d'||evidence.sourceFileCount!==2200||evidence.sourceVerification.unchangedFilesChecked!==2195)throw Error('Source changed');fs.writeFileSync(process.argv[3]+'/source-after.json',JSON.stringify(evidence,null,2)+'\n');
JS
 if [[ "$failed" == 1 && "$stopped" == 1 ]];then mv -- "$PERF_LAB_SOCKET" "$stage/failed-evidence-raw-pg" || true;fi
 if [[ "$failed" != 0 ]];then status=1;fi
 printf '{"finalExitCode":%s,"preservationOrShutdownFailed":%s,"privatePgStopped":%s}\n' "$status" "$failed" "$stopped" > "$stage/cleanup.json" || status=1
 exit "$status"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
cp "$PERF_LAB_SOCKET/schema-inventory.json" "$stage/schema-before.json"
node --input-type=module - "$stage" <<'JS'
import fs from'node:fs';const pid=Number(fs.readFileSync(process.env.PERF_LAB_SOCKET+'/data/postmaster.pid','utf8').split('\n')[0]);fs.writeFileSync(process.argv[2]+'/private-runtime.json',JSON.stringify({socket:process.env.PERF_LAB_SOCKET,postgresPid:pid,port:3481})+'\n');
JS
node --input-type=module - "$snapshot" "$stage" <<'JS'
import fs from'node:fs';import{execFileSync}from'node:child_process';import{pathToFileURL}from'node:url';const s=process.argv[2],out=process.argv[3],plan=JSON.parse(fs.readFileSync(process.env.PERF_CAPTURE_PLAN));if(fs.realpathSync(s)!==s||fs.readFileSync(s+'/.next/BUILD_ID','utf8').trim()!=='wTBAqKGVn-GRqajiTebMf')throw Error('Exact retained compiled source required');const{sourceEvidence}=await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));const e=await sourceEvidence(process.env.PERF_SOURCE_ROOT,s,plan.sourceBuild,'after-lab-transforms');if(e.sourceFingerprint!==plan.sourceFingerprint||e.sourceFileCount!==2200||e.sourceVerification.unchangedFilesChecked!==2195)throw Error('Source differs');fs.mkdirSync(out+'/prior-generated',{mode:0o700});for(const name of['source-evidence.json','perf/fixtures.json','preflight.json']){const original=s+'/'+name;if(fs.existsSync(original)){const dest=out+'/prior-generated/'+name.replaceAll('/','-');fs.copyFileSync(original,dest);if(!fs.readFileSync(original).equals(fs.readFileSync(dest)))throw Error('Preservation failed');}}const fixture=JSON.parse(fs.readFileSync(process.env.PERF_LAB_FIXTURES));if(fixture.provenance!=='isolated-seeded-app'||fixture.productionDatabase!==false)throw Error('Synthetic fixture required');fs.copyFileSync(process.env.PERF_LAB_FIXTURES,s+'/perf/fixtures.json');fs.rmSync(s+'/uploads',{recursive:true,force:true});execFileSync('rsync',['-a',process.env.PERF_LAB_ASSETS+'/',s+'/'],{timeout:30000});fs.writeFileSync(s+'/source-evidence.json',JSON.stringify(e,null,2));fs.writeFileSync(out+'/source-before.json',JSON.stringify(e,null,2));
JS
export PERF_FIXTURES="$snapshot/perf/fixtures.json" PERF_BUILD=wTBAqKGVn-GRqajiTebMf
export PERF_BASE_URL=http://127.0.0.1:3481 PERF_JOURNEY_ADAPTER="$harness/perf/journeys.mjs" PERF_CELL_PRELUDE="$harness/perf/lab/calibration-cell-prelude.sh"
export PERF_LOG_DIR="$stage/numeric-telemetry"
node "$harness/perf/lab/calibration-state.mjs" snapshot > "$stage/snapshot.log" 2>&1
bash "$PERF_CELL_PRELUDE" initial > "$stage/initial-certificate.json"
PERF_CALIBRATION_SMOKE=1 node /tmp/foremanhq-calibration15-smoke-perturb.mjs > "$stage/perturb.json"
PERF_CELL_LINK=Office PERF_CELL_JOURNEY=changeqty bash "$PERF_CELL_PRELUDE" > "$stage/restored-certificate.json"
node --input-type=module - "$stage" <<'JS'
import fs from'node:fs';const root=process.argv[2],initial=JSON.parse(fs.readFileSync(root+'/initial-certificate.json')),restored=JSON.parse(fs.readFileSync(root+'/restored-certificate.json'));if(!initial.stateVerified||!restored.stateVerified||initial.stateSha256!==restored.stateSha256||initial.seedSnapshotSha256!==restored.seedSnapshotSha256||restored.readPreflightCount!==14||!restored.drain.priorServerAbsent)throw Error('Private reset smoke failed');fs.writeFileSync(root+'/smoke-result.json',JSON.stringify({smokeOnly:true,timingSamples:0,status:'passed',restoredExactStageSeed:true,sourceBuild:restored.sourceBuild,initialStateSha256:initial.stateSha256,restoredStateSha256:restored.stateSha256,preflightQueriesPerStart:14},null,2)+'\n');
JS
