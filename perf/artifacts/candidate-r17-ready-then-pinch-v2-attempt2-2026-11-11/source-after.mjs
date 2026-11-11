import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { sourceEvidence } = await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));
const evidence=await sourceEvidence(process.env.PERF_SOURCE_ROOT,process.env.PERF_REUSE_SNAPSHOT,'b1c2adf31950c6f3db7ab189bbeabce29df5d6d9766418f3a9935bdde94f234b','after-lab-transforms');
if(evidence.sourceFingerprint!=='be7f23501ec71b78974bc9f818fc75b46abfd0a4de0ad83288de7a49826c37cc'||evidence.sourceFileCount!==2316||evidence.sourceVerification.unchangedFilesChecked!==2311)throw Error('Source changed during capture');
fs.writeFileSync(process.env.PERF_RUN_EVIDENCE_DIR+'/source-evidence-after.json',JSON.stringify(evidence,null,2)+'\n');
