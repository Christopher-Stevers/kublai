// Read-only canonical artifact inspection. No application, listener or DB loads.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
const repo='/home/tim/.openclaw/workspace/kublai';
const source='/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r20-20261111';
const base='/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r19-20261111';
const active='/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110/.next-canonical-a';
const build=source+'/.next-web', proof='/home/tim/.openclaw/workspace/releases/speed-proof-20261110';
const {files}=await import(source+'/scripts/release/static-assets.mjs');
const {fingerprintSource}=await import(source+'/scripts/release/source-fingerprint.mjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected=JSON.parse(await fs.readFile(repo+'/perf/artifacts/phase1-r20-source-freeze-2026-11-11.json'));
const {manifest:_private,...fingerprint}=await fingerprintSource(source);
assert.equal(fingerprint.sourceFingerprint,expected.sourceFingerprint);assert.equal(fingerprint.sourceFileCount,2318);
const release=JSON.parse(await fs.readFile(build+'/release-assets.json'));
const buildId=(await fs.readFile(build+'/BUILD_ID','utf8')).trim();
assert.equal(release.sourceHash,buildId);assert.equal(release.sourceFingerprint,fingerprint.sourceFingerprint);
const selected=new Set([...expected.runtimeChangedPaths,...expected.testChangedPaths]);
let unchanged=0;
for(const dir of ['src','public','scripts','vendor'])for(const name of await files(base+'/'+dir)){
 const rel=dir+'/'+name;if(selected.has(rel))continue;
 assert((await fs.readFile(base+'/'+rel)).equals(await fs.readFile(source+'/'+rel)),rel);unchanged++;
}
for(const row of expected.changes)assert.equal(sha(await fs.readFile(source+'/'+row.path)),row.postimageSha256);
for(const config of ['next.config.js','postcss.config.js','package.json','pnpm-lock.yaml','tsconfig.json','next-env.d.ts'])assert((await fs.readFile(base+'/'+config)).equals(await fs.readFile(source+'/'+config)));
const run=(args,name,allowed=[0])=>{
 const response=spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8'});
 if(!allowed.includes(response.status))throw Error(name+' failed: '+response.stderr);
 return fs.writeFile(proof+'/'+name+'.json',response.stdout).then(()=>JSON.parse(response.stdout));
};
const metrics=await run([repo+'/scripts/release/static-metrics.mjs',build,active],'phase1-r20-static-metrics');
const versusR19=await run([repo+'/scripts/release/static-metrics.mjs',build,base+'/.next-web'],'phase1-r20-static-relative-r19');
const delta=await run([repo+'/scripts/release/check-small-change.mjs',base+'/.next-web',build],'phase1-r20-small-change',[0,1]);
const native=await run([repo+'/perf/artifacts/phase1-r14-native-inspection.mjs',build],'phase1-r20-native-inspection');
let sidecars=0,retained=0,publicFiles=0,devOverlay=0,probe=0;
for(const name of release.currentAssets){const bytes=await fs.readFile(build+'/static/'+name);assert(brotliDecompressSync(await fs.readFile(build+'/static/'+name+'.br')).equals(bytes));assert(gunzipSync(await fs.readFile(build+'/static/'+name+'.gz')).equals(bytes));sidecars++;}
for(const name of await files(active+'/static')){assert((await fs.readFile(active+'/static/'+name)).equals(await fs.readFile(build+'/static/'+name)),name);retained++;}
for(const name of await files(base+'/public')){const bytes=await fs.readFile(base+'/public/'+name);assert(bytes.equals(await fs.readFile(source+'/public/'+name)));assert(bytes.equals(await fs.readFile(build+'/runtime/public/'+name)));publicFiles++;}
for(const name of release.currentScripts){const text=await fs.readFile(build+'/static/'+name,'utf8');if(/SpeedDevelopmentOverlay|Development speed measurements/.test(text))devOverlay++;if(/data-press-build-probe|r17-cache-group-control/.test(text))probe++;}
assert.equal(devOverlay,0);assert.equal(probe,0);
const statsBytes=await fs.readFile(build+'/analysis/client-stats.json'),stats=JSON.parse(statsBytes);assert.equal(stats.sourceBuild,buildId);
const press=stats.stats.modules.filter(m=>m.name==='./src/hooks/use-press.ts').map(m=>({id:m.id,layer:m.layer,chunks:m.chunks,files:stats.stats.chunks.filter(c=>m.chunks?.includes(c.id)).flatMap(c=>c.files)}));
assert.equal(press.length,1);assert.equal(press[0].chunks.length,1);assert(press[0].files.some(f=>f.includes('app-press-browser')));
assert.equal((await fs.readFile(source+'/src/app/jobs/JobsClient.tsx','utf8')).includes('feedback="attribute"'),false);
const lockAbsent=!(await fs.stat('/home/tim/.cache/foremanhq-release-builder.lock').then(()=>true,()=>false));assert(lockAbsent);
assert.equal(await fs.readFile(source+'/src/lib/part-image-layouts.json','utf8'),await fs.readFile(base+'/src/lib/part-image-layouts.json','utf8'));
const result={sourceBuild:buildId,...fingerprint,canonicalExit:0,productionTypeScriptPassed:true,prerenderPassed:true,sourceLawsPassed:true,metrics,versusR19,strictR19ToR20:delta,phase0Ratchets:{shared:metrics.sharedGzipBytes<=502618,heaviest:metrics.screenGzipBytes<=758531,deploy:metrics.deployGzipBytes<=2734731},finalTargets:{shared120000:metrics.sharedGzipBytes<=120000,heaviest180000:metrics.screenGzipBytes<=180000},sourcePostimagesExact:true,unaffectedInputFilesExact:unchanged,allCurrentAssetsBrotliGzipDecodedExact:sidecars,allActiveHistoricalStaticFilesExact:retained,publicSourceAndRuntimeExact:publicFiles,developmentOverlayAbsent:true,inertProbeAbsent:true,pressAllocation:press,nativeInspection:native,statsSha256:sha(statsBytes),buildLogSha256:sha(await fs.readFile(proof+'/phase1-r20-build.log')),builderLockAbsent:lockAbsent,httpStarted:false,applicationRuntimeStarted:false,databaseStarted:false,activated:false};
await fs.writeFile(proof+'/phase1-r20-offline-proof.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({sourceBuild:buildId,sourceFingerprint:fingerprint.sourceFingerprint,shared:metrics.sharedGzipBytes,heaviest:metrics.screenGzipBytes,deploy:metrics.deployGzipBytes,strictChangedGzipBytes:delta.changedGzipBytes,strictPass:delta.passes,sidecars,retained,publicFiles,press,nativePass:native.passed},null,2));
