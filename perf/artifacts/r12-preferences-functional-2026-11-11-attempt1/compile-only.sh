#!/usr/bin/env bash
set -euo pipefail
harness=${PERF_HARNESS_DIR:?}
[[ "$harness" == /tmp/foremanhq-perf-method-f9bHR6 ]]
[[ "${PERF_SOURCE_ROOT:?}" == /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r12-20261111 ]]
[[ "${PERF_SOURCE_BUILD_DIST:?}" == "$PERF_SOURCE_ROOT/.next-web" ]]
[[ "$(cat "$PERF_SOURCE_BUILD_DIST/BUILD_ID")" == d18cbd7b82933e2e0dc0999ccfcf2054aa7cf095946de1a379d6b0365e8b7736 ]]
export FOREMANHQ_BACKGROUND_MODE=separate BIM_WORKER_DISABLED=1 SKIP_ENV_VALIDATION=1
export CLERK_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_speed_lab_only
export STRIPE_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_speed_lab_only
export NEXT_PUBLIC_BUILD_ID=isolated-speed-baseline
unset NEXT_DIST_DIR NEXT_TSCONFIG_PATH FOREMANHQ_RUNTIME_DIR FOREMANHQ_PUBLIC_DIR
snapshot=$(node "$harness/perf/create-lab-snapshot.mjs")
printf '%s\n' "$snapshot" > /tmp/foremanhq-r12-compiled-snapshot
export PERF_R12_SNAPSHOT="$snapshot"
node --input-type=module <<'JS'
import fs from 'node:fs';import path from 'node:path';
const s=process.env.PERF_R12_SNAPSHOT,e=JSON.parse(fs.readFileSync(path.join(s,'source-evidence.json')));
if(!s.startsWith('/tmp/foremanhq-speed-app-')||!fs.existsSync(path.join(s,'PERF_LAB_ONLY'))||e.sourceBuild!=='d18cbd7b82933e2e0dc0999ccfcf2054aa7cf095946de1a379d6b0365e8b7736'||e.sourceFingerprint!=='f8aea0644b7c7471a1bdae597535001c44a6e0a337b8ef875da68e9c24327c09'||e.sourceFileCount!==2308||e.sourceVerification.unchangedFilesChecked!==2303)throw Error('Wrong R12 snapshot');
fs.writeFileSync('/tmp/foremanhq-r12-compile-source-before.json',JSON.stringify(e,null,2));
JS
cd "$snapshot"
./node_modules/.bin/next build --webpack > /tmp/foremanhq-r12-lab-build.log 2>&1 || { tail -70 /tmp/foremanhq-r12-lab-build.log;exit 1; }
node --input-type=module <<'JS'
import fs from 'node:fs';import path from 'node:path';import{pathToFileURL}from'node:url';
const{sourceEvidence}=await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));const s=process.env.PERF_R12_SNAPSHOT;const e=await sourceEvidence(process.env.PERF_SOURCE_ROOT,s,'d18cbd7b82933e2e0dc0999ccfcf2054aa7cf095946de1a379d6b0365e8b7736','after-lab-transforms');if(e.sourceFingerprint!=='f8aea0644b7c7471a1bdae597535001c44a6e0a337b8ef875da68e9c24327c09')throw Error('Source changed during compile');
fs.writeFileSync('/tmp/foremanhq-r12-lab-compiled.json',JSON.stringify({snapshot:s,labBuild:fs.readFileSync(path.join(s,'.next/BUILD_ID'),'utf8').trim(),source:e,compileOnly:true,serverStarted:false},null,2));
JS
