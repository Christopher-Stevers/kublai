import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { sourceEvidence } = await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));
const evidence=await sourceEvidence(process.env.PERF_SOURCE_ROOT,process.env.PERF_REUSE_SNAPSHOT,'c25f525d3a4755145e22b9977b300607209034ff59196ee170cbe219cf2c2e5d','after-lab-transforms');
if(evidence.sourceFingerprint!=='128da6e7cd4b35dce132d543a56ed673f8dce30fae56f7456b1fc3d94f5e8dd2'||evidence.sourceFileCount!==2200||evidence.sourceVerification.unchangedFilesChecked!==2195)throw Error('Source changed during capture');
fs.writeFileSync(process.env.PERF_RUN_EVIDENCE_DIR+'/source-evidence-after.json',JSON.stringify(evidence,null,2)+'\n');
