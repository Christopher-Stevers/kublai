import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { sourceEvidence } = await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));
const evidence=await sourceEvidence(process.env.PERF_SOURCE_ROOT,process.env.PERF_REUSE_SNAPSHOT,'47b6e70541a3f513f852e93aef05aa4f389544f72f4626082f447f53d0956ece','after-lab-transforms');
if(evidence.sourceFingerprint!=='4541b37e0ff7144287d9187384eeb9ae7ebe1c9aa88e31fcaa53cee03a8b05c7'||evidence.sourceFileCount!==2317||evidence.sourceVerification.unchangedFilesChecked!==2312)throw Error('Source changed during capture');
fs.writeFileSync(process.env.PERF_RUN_EVIDENCE_DIR+'/source-evidence-after.json',JSON.stringify(evidence,null,2)+'\n');
