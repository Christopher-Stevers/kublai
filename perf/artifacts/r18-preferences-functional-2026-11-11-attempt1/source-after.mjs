import fs from 'node:fs';import{pathToFileURL}from'node:url';
const metadata=JSON.parse(fs.readFileSync('/tmp/foremanhq-r18-lab-compiled.json'));
const{sourceEvidence}=await import(pathToFileURL(process.env.PERF_HARNESS_DIR+'/scripts/release/source-fingerprint.mjs'));
const e=await sourceEvidence(process.env.PERF_SOURCE_ROOT,metadata.snapshot,'c58613f12a7ae0590934ecdb15ddbc7a39e3a2f587f26d5f98792c92a4de64e8','after-lab-transforms');
if(e.sourceFingerprint!=='ec149c2ed24935019cae5150c928b9af6606d8c41c8eba552d2a9185cf1b05dd'||e.sourceFileCount!==2317||e.sourceVerification.unchangedFilesChecked!==2312)throw Error('Functional source changed');
fs.writeFileSync('/tmp/foremanhq-r18-pref-v6-evidence/source-evidence-after.json',JSON.stringify(e,null,2)+'\n');
