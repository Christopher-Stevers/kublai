import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { sourceEvidence } = await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));
const evidence=await sourceEvidence(process.env.PERF_SOURCE_ROOT,process.env.PERF_REUSE_SNAPSHOT,'e9fcb1f86b41ddb9987a260ab2879e5cbcbd7d8798b7f386dc85909ebc44cd7c','after-lab-transforms');
if(evidence.sourceFingerprint!=='b6f4093d05deb01c23630d6fcb223fa04a6dacf46625414a5d1ffcafa891ca4f'||evidence.sourceFileCount!==2318||evidence.sourceVerification.unchangedFilesChecked!==2313)throw Error('Source changed during capture');
fs.writeFileSync(process.env.PERF_RUN_EVIDENCE_DIR+'/source-evidence-after.json',JSON.stringify(evidence,null,2)+'\n');
