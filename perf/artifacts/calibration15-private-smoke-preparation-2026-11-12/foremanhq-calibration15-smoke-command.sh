#!/usr/bin/env bash
set -euo pipefail
export PERF_HARNESS_DIR=/tmp/foremanhq-perf-method-oMDyHJ
export PERF_SOURCE_ROOT=/home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112
export PERF_SOURCE_BUILD_DIST="$PERF_SOURCE_ROOT/.next-web"
export PERF_REUSE_SNAPSHOT=/tmp/foremanhq-speed-app-fxHxrn
export PERF_SYNTHETIC_CACHE_ROOT=/tmp/foremanhq-speed-app-5h2kmq
root=/tmp/foremanhq-calibration15-smoke-20261112
[[ ! -e "$root" ]];mkdir -m 700 "$root" "$root/stage"
export PERF_STAGE_EVIDENCE_DIR="$root/stage" PERF_CAPTURE_PLAN="$root/capture-plan.json" PERF_PG_ERROR_REPORT="$root/stage/pg-errors.json"
node --input-type=module - "$PERF_CAPTURE_PLAN" <<'JS'
import fs from'node:fs';import{verifyFrozenHarness}from'/tmp/foremanhq-perf-method-oMDyHJ/perf/harness-fingerprint.mjs';import{FIXTURE_PRELUDE,PROTOCOL_ID}from'/tmp/foremanhq-perf-method-oMDyHJ/perf/calibrated-policy.mjs';const method=await verifyFrozenHarness('/tmp/foremanhq-perf-method-oMDyHJ');if(method.harnessFingerprint!=='ad23c121cc009c84e1c805d5caa99bdcf38536f06637bada178b9cd1af0a2794')throw Error('Frozen method differs');fs.writeFileSync(process.argv[2],JSON.stringify({smokeOnly:true,protocolId:PROTOCOL_ID,sealedAt:new Date().toISOString(),sourceBuild:'9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0',sourceFingerprint:'34f0c1508584e40382ad25955b3aa2b5703bdd78ced4e6ef2536e902fd82281d',build:'wTBAqKGVn-GRqajiTebMf',harnessFingerprint:method.harnessFingerprint,fixturePrelude:FIXTURE_PRELUDE},null,2)+'\n',{mode:0o444});
JS
node "$PERF_HARNESS_DIR/perf/lab/calibration-storage.mjs"
status=0
python3 "$PERF_HARNESS_DIR/perf/lab/owned-process-supervisor.py" run --seconds 440 --record "$root/stage/stage-processes.json" -- bash "$PERF_HARNESS_DIR/perf/lab/database.sh" bash /tmp/foremanhq-calibration15-private-smoke.sh > "$root/stage.log" 2>&1 || status=$?
node --input-type=module - "$root" "$status" <<'JS'
import fs from'node:fs';import net from'node:net';const root=process.argv[2],stage=root+'/stage',read=f=>JSON.parse(fs.readFileSync(stage+'/'+f)),status=Number(process.argv[3]);const owner=read('stage-processes.json'),cleanup=read('cleanup.json'),runtime=read('private-runtime.json'),errors=read('pg-errors.json').errors,smoke=fs.existsSync(stage+'/smoke-result.json')?read('smoke-result.json'):null;const sourceStable=read('source-before.json').sourceFingerprint===read('source-after.json').sourceFingerprint;const schemaStable=fs.readFileSync(stage+'/schema-before.json').equals(fs.readFileSync(stage+'/pg-schema-inventory.json'));const portOpen=await new Promise(resolve=>{const s=net.createConnection({host:'127.0.0.1',port:3481});s.setTimeout(500);s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(true)});});const absent=owner.processes.every(p=>!fs.existsSync('/proc/'+p.pid));const result={smokeOnly:true,timingSamples:0,status,ownerStopped:owner.status==='stopped',familyAbsent:owner.familyAbsent,allRecordedPidsAbsent:absent,portClosed:!portOpen,privateSocketRemoved:!fs.existsSync(runtime.socket),postgresAbsent:!fs.existsSync('/proc/'+runtime.postgresPid),sourceStable,schemaStable,unexpectedPgErrors:errors.length,cleanup,smoke};result.passed=status===0&&owner.status==='stopped'&&owner.familyAbsent&&owner.ownedIdentitiesAbsent&&absent&&!portOpen&&result.privateSocketRemoved&&result.postgresAbsent&&sourceStable&&schemaStable&&!errors.length&&cleanup.finalExitCode===0&&smoke?.status==='passed';fs.writeFileSync(root+'/final-smoke.json',JSON.stringify(result,null,2)+'\n');if(!result.passed)process.exitCode=1;
JS
