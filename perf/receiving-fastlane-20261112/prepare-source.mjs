// Preparation only. Do not execute during calibration quiet. Never builds/deploys.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const proposal=new URL('./',import.meta.url);
const releases='/home/tim/.openclaw/workspace/releases';
const names=['src','public','scripts','vendor','next.config.js','postcss.config.js','package.json','pnpm-lock.yaml','tsconfig.json','next-env.d.ts'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inventory(root){
 const result={};
 async function walk(name){const p=path.join(root,name);let stat;try{stat=await fs.lstat(p)}catch(error){if(error.code==='ENOENT')return;throw error}
  if(stat.isSymbolicLink())throw Error('Unexpected source symlink '+name);
  if(stat.isDirectory())for(const child of (await fs.readdir(p)).sort())await walk(path.join(name,child));
  else if(stat.isFile())result[name]=sha(await fs.readFile(p));
 }
 for(const name of names)await walk(name);return result;
}
const destination=process.argv[2];
const validation=process.argv[3]==='--validation';
if(process.argv[3]&&!validation)throw Error('Unknown source preparation mode');
if(validation&&!path.basename(destination??'').startsWith('speed-phase0-receiving-rc-validation-'))throw Error('Distinct validation-only directory required');
if(!destination||!path.isAbsolute(destination)||path.dirname(destination)!==releases||!/^speed-phase0-receiving-rc-[A-Za-z0-9_-]+$/.test(path.basename(destination)))throw Error('Explicit new receiving RC source directory required');
const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',proposal)));
assert.equal(manifest.status,'source-only-needs-review');assert.deepEqual(manifest.failures,[]);
const base=manifest.baseSource,active=path.join(base,'.next-web');
assert.equal((await fs.readFile(active+'/BUILD_ID','utf8')).trim(),manifest.baseBuild);
assert.equal(await fs.realpath('/home/tim/.openclaw/workspace/kublai/.next'),active);
const {fingerprintSource}=await import('/home/tim/.openclaw/workspace/kublai/scripts/release/source-fingerprint.mjs');
assert.equal((await fingerprintSource(base)).sourceFingerprint,manifest.baseFingerprint);
const before=await inventory(base);
for(const [name,record]of Object.entries(manifest.runtimePaths)){
 assert.equal(before[name]??null,record.preimage);
 assert.equal(sha(await fs.readFile(new URL('runtime/'+name,proposal))),record.postimage);
}
// mkdir without recursive replacement: retain partial failure for inspection.
await fs.mkdir(destination,{recursive:false});
for(const name of names){try{await fs.cp(path.join(base,name),path.join(destination,name),{recursive:true,dereference:false})}catch(error){if(error.code!=='ENOENT')throw error}}
for(const name of ['node_modules','.env','.env.local','.env.production','.env.production.local']){
 try{await fs.symlink(await fs.realpath(path.join(base,name)),path.join(destination,name))}catch(error){if(error.code!=='ENOENT')throw error}
}
await fs.symlink(active,path.join(destination,'.next'));
for(const name of Object.keys(manifest.runtimePaths))await fs.copyFile(new URL('runtime/'+name,proposal),path.join(destination,name));
const expectedPaths=[...Object.keys(manifest.runtimePaths)];
if(validation){const v=JSON.parse(await fs.readFile(new URL('validation-manifest.json',proposal)));assert.deepEqual(v.failures,[]);for(const [name,record]of Object.entries(v.testPaths)){assert.equal(before[name]??null,record.preimage);const bytes=await fs.readFile(new URL('validation/'+name,proposal));assert.equal(sha(bytes),record.postimage);await fs.writeFile(path.join(destination,name),bytes);expectedPaths.push(name);}await fs.writeFile(path.join(destination,'PERF_LAB_ONLY'),'Receiving RC validation tree; never deploy\n',{flag:'wx'});}
const after=await inventory(destination);
const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(name=>before[name]!==after[name]).sort();
assert.deepEqual(changed,expectedPaths.sort());
assert.equal(after['src/components/catalogue/CatalogueVisibility.tsx'],before['src/components/catalogue/CatalogueVisibility.tsx']);
const {manifest:_private,...fingerprint}=await fingerprintSource(destination);
const result={...fingerprint,baseSource:base,baseBuild:manifest.baseBuild,changedRuntimePaths:changed,mode:validation?'validation-only':'deploy-source',runtimeManifestSha256:sha(await fs.readFile(new URL('manifest.json',proposal))),validationManifestSha256:validation?sha(await fs.readFile(new URL('validation-manifest.json',proposal))):null,validationPatchNotApplied:!validation,buildStarted:false,activated:false};
await fs.writeFile(path.join(destination,'RECEIVING_RC_SOURCE.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
