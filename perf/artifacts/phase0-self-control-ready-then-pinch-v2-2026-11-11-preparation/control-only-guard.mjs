// Operational control-purpose guard; never changes the frozen timing method.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateProtocolConfig} from '/tmp/foremanhq-phase0-control-protocol-guard.mjs';
export const EXPECTED={
 PERF_CONTROL_ONLY:'phase0-self-comparison',
 PERF_DIAGNOSTICS:'0',
 CHROMIUM_PATH:'/usr/bin/chromium',
 PERF_HARNESS_DIR:'/tmp/foremanhq-perf-method-f9bHR6',
 PERF_SOURCE_ROOT:'/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110',
 PERF_SOURCE_BUILD_DIST:'/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110/.next-canonical-a',
 PERF_BASELINE_DIST:'/home/tim/.openclaw/workspace/releases/foremanhq-job-numbering-20261110/.next',
 PERF_COMPARISON_BASELINE:'/home/tim/.openclaw/workspace/kublai/perf/artifacts/baseline-ready-then-pinch-v2-rerun-2026-11-11-1.json',
 PERF_STABILITY_REFERENCE:'/home/tim/.openclaw/workspace/kublai/perf/artifacts/baseline-ready-then-pinch-v2-rerun-2026-11-11-2.json',
 PERF_REUSE_SNAPSHOT:'/tmp/foremanhq-speed-app-5h2kmq',
 PERF_SYNTHETIC_CACHE_ROOT:'/tmp/foremanhq-speed-app-5h2kmq',
 PERF_IDLE_DURATION_MS:'600000',
 PERF_RUN_EVIDENCE_DIR:'/tmp/foremanhq-phase0-control-full-v2-evidence',
};
export function validateControlConfig(env,first,second){
 const protocol=validateProtocolConfig(env,first);
 for(const[key,value]of Object.entries(EXPECTED))if(env[key]!==value)throw Error('Control binding differs: '+key);
 for(const key of ['PERF_PILOT','PERF_LINKS','PERF_JOURNEYS','PERF_RUNS'])if(env[key]!==undefined)throw Error('Subset/pilot flag forbidden: '+key);
 for(const report of [first,second])if(report.build!=='cI20Tzl0OAQscfvjfmtFW'||report.sourceBuild!=='c25f525d3a4755145e22b9977b300607209034ff59196ee170cbe219cf2c2e5d'||report.sourceFingerprint!=='128da6e7cd4b35dce132d543a56ed673f8dce30fae56f7456b1fc3d94f5e8dd2'||report.harnessFingerprint!=='25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4'||report.protocol?.id!=='ready-then-pinch-v2')throw Error('Accepted baseline binding differs');
 return {...protocol,controlOnly:true,releaseCandidate:false,doesNotClearR20:true,prospectiveTrial:1,authorizedAdditionalTrials:0,controlEnvironment:EXPECTED};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const first=fs.readFileSync(process.env.PERF_COMPARISON_BASELINE),second=fs.readFileSync(process.env.PERF_STABILITY_REFERENCE);
 const digest=b=>createHash('sha256').update(b).digest('hex');
 if(digest(first)!=='c262451ec3ef1ca979585aeb29ccc6bd67444d0a323d248584ccf74bb6d9acd4'||digest(second)!=='fa25762b3122cdebc609a045b084bc5322e2c061071a0eb0310842bf3f61a718')throw Error('Accepted baseline bytes changed');
 const result=validateControlConfig(process.env,JSON.parse(first),JSON.parse(second));
 if(fs.readFileSync(process.env.PERF_SOURCE_BUILD_DIST+'/BUILD_ID','utf8').trim()!=='c25f525d3a4755145e22b9977b300607209034ff59196ee170cbe219cf2c2e5d'||fs.readFileSync(process.env.PERF_BASELINE_DIST+'/BUILD_ID','utf8').trim()!=='UzwdBuKm2iDE8zDCyDcEI'||fs.readFileSync(process.env.PERF_REUSE_SNAPSHOT+'/.next/BUILD_ID','utf8').trim()!=='cI20Tzl0OAQscfvjfmtFW')throw Error('Actual compiled identity differs');
 console.log(JSON.stringify(result));
}
