import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { sourceEvidence } = await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));
const evidence=await sourceEvidence(process.env.PERF_SOURCE_ROOT,process.env.PERF_REUSE_SNAPSHOT,'9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0','after-lab-transforms');
if(evidence.sourceFingerprint!=='34f0c1508584e40382ad25955b3aa2b5703bdd78ced4e6ef2536e902fd82281d'||evidence.sourceFileCount!==2200||evidence.sourceVerification.unchangedFilesChecked!==2195)throw Error('Source changed during capture');
fs.writeFileSync(process.env.PERF_RUN_EVIDENCE_DIR+'/source-evidence-after.json',JSON.stringify(evidence,null,2)+'\n');
