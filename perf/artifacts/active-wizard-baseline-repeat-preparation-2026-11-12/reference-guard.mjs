import fs from 'node:fs';
import{createHash}from'node:crypto';
import{pathToFileURL}from'node:url';
import{validateProtocolConfig}from'/tmp/foremanhq-active-wizard-repeat-protocol-guard.mjs';
export const firstPath='/home/tim/.openclaw/workspace/kublai/perf/artifacts/wizard-fastlane-ready-then-pinch-v2-2026-11-12/report.json';
export function validateReference(env,first){
 const result=validateProtocolConfig(env,first);
 const expected={PERF_COMPARISON_BASELINE:firstPath,PERF_SOURCE_ROOT:'/home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112',PERF_SOURCE_BUILD_DIST:'/home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112/.next-web',PERF_BASELINE_DIST:'/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110/.next-canonical-a',PERF_REUSE_SNAPSHOT:'/tmp/foremanhq-speed-app-fxHxrn',PERF_HARNESS_DIR:'/tmp/foremanhq-perf-method-f9bHR6',PERF_IDLE_DURATION_MS:'600000',PERF_DIAGNOSTICS:'0',CHROMIUM_PATH:'/usr/bin/chromium'};
 for(const[k,v]of Object.entries(expected))if(env[k]!==v)throw Error('Reference configuration differs: '+k);
 for(const k of['PERF_PILOT','PERF_LINKS','PERF_JOURNEYS','PERF_RUNS'])if(env[k]!==undefined)throw Error('Subset flag forbidden: '+k);
 if(first.sourceBuild!=='9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0'||first.sourceFingerprint!=='34f0c1508584e40382ad25955b3aa2b5703bdd78ced4e6ef2536e902fd82281d'||first.build!=='wTBAqKGVn-GRqajiTebMf'||first.harnessFingerprint!=='25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4'||first.samples.length!==120)throw Error('First active-source report differs');
 if(first.static.sharedGzipBytes!==502616||first.static.screenGzipBytes!==758529||first.static.deployGzipBytes!==33690)throw Error('First static reference differs');
 return{...result,purpose:'independent-active-source-repeatability',fixedFirstSha256:'50a18a58409e9db3b19c5a3e2211fd7c4228437e8c65f7b0668f5db79eae6583',doesNotClearR20:true,authorizedRepeats:1};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const bytes=fs.readFileSync(process.env.PERF_COMPARISON_BASELINE);if(createHash('sha256').update(bytes).digest('hex')!=='50a18a58409e9db3b19c5a3e2211fd7c4228437e8c65f7b0668f5db79eae6583')throw Error('Fixed first report bytes differ');
 const result=validateReference(process.env,JSON.parse(bytes));
 for(const[p,id]of[[process.env.PERF_SOURCE_BUILD_DIST,'9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0'],[process.env.PERF_BASELINE_DIST,'c25f525d3a4755145e22b9977b300607209034ff59196ee170cbe219cf2c2e5d'],[process.env.PERF_REUSE_SNAPSHOT+'/.next','wTBAqKGVn-GRqajiTebMf']])if(fs.readFileSync(p+'/BUILD_ID','utf8').trim()!==id)throw Error('Actual build binding differs');
 console.log(JSON.stringify(result));
}
