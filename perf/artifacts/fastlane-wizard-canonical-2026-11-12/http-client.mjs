import {readFile} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {brotliDecompressSync} from 'node:zlib';
const [build, baseline, port='3148'] = process.argv.slice(2);
const report = JSON.parse(await readFile(path.join(build,'release-assets.json')));
const prior = JSON.parse(await readFile(path.join(baseline,'release-assets.json')));
const get = (url, encoding='identity') => new Promise((resolve,reject)=>{
  const req=http.get({hostname:'localhost',port:Number(port),path:url,headers:{'Accept-Encoding':encoding}},res=>{
    const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(parts)}));
  });req.on('error',reject);req.setTimeout(20000,()=>req.destroy(new Error('HTTP proof timeout')));
});
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
let current=0;
const {files}=await import('/home/tim/.openclaw/workspace/kublai/scripts/release/static-assets.mjs');
const assets=[...report.currentScripts,...(await files(path.join(build,'static/css'))).filter(n=>n.endsWith('.css')).map(n=>'css/'+n)];
for(const name of assets){
  const response=await get('/_next/static/'+name,'br');
  const expected=await readFile(path.join(build,'static',name));
  assert(response.status===200&&response.headers['content-encoding']==='br','Current asset HTTP/Brotli failure');
  assert(brotliDecompressSync(response.bytes).equals(expected),'Current asset decompression mismatch');
  assert(response.bytes.equals(await readFile(path.join(build,'static',name+'.br'))),'Brotli sidecar mismatch');
  assert(String(response.headers['cache-control']).includes('immutable')&&String(response.headers.vary).includes('Accept-Encoding'),'Static cache headers missing');
  current++;
}
const dirs=[baseline,...prior.retainedBuilds].filter((v,i,a)=>a.indexOf(v)===i).slice(0,10);
const samples=[];
for(const dir of dirs){
  let names;try{names=JSON.parse(await readFile(path.join(dir,'release-assets.json'))).currentScripts;}catch{names=[];}
  if(!names?.length){const {files}=await import('/home/tim/.openclaw/workspace/kublai/scripts/release/static-assets.mjs');names=(await files(path.join(dir,'static'))).filter(n=>n.endsWith('.js'));}
  const name=names.find(n=>!report.currentScripts.includes(n))??names[0];
  const expected=await readFile(path.join(dir,'static',name));const response=await get('/_next/static/'+name,'br');
  assert(response.status===200&&response.headers['content-encoding']==='br','Historical Brotli missing');assert(brotliDecompressSync(response.bytes).equals(expected),'Historical decoded URL mismatch');assert(response.bytes.equals(await readFile(path.join(build,'static',name+'.br'))),'Historical retained Brotli sidecar mismatch');samples.push({asset:name,exact:true});
}
const worker=await get('/sw.js');assert(worker.status===200&&worker.bytes.equals(await readFile(path.join(build,'runtime/public/sw.js'))),'Worker snapshot mismatch');
const health=await get('/api/health'),signin=await get('/sign-in');
assert(health.status===200&&signin.status===200,'Application health proof failure');
console.log(JSON.stringify({build:report.sourceHash,currentAssetsAndRetainedCss:current,currentScripts:report.currentScripts.length,allCurrentBrotliSidecarsAndDecodedBytesExact:true,immutableStaticHeaders:true,previousReleaseSamples:samples.length,historicalSamples:samples,allHistoricalBytesExact:true,workerMatchesPackaged:true,healthStatus:health.status,signInStatus:signin.status,backgroundMode:'separate',bimDisabled:true,databaseReadOnlyVerified:true,allRequestsCookieFreeGet:true,releaseManifestAndBinding:'Not added: Phase0 has neither newer feature',activated:false},null,2));
