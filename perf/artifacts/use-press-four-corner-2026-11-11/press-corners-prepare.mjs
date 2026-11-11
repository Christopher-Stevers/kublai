import {cp,mkdir,readFile,writeFile,symlink,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const repo='/home/tim/.openclaw/workspace/kublai', base='/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r17-20261111';
const out='/home/tim/.openclaw/workspace/releases/press-chunk-four-corner-20261111';
const {fingerprintSource}=await import(base+'/scripts/release/source-fingerprint.mjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const a=await fingerprintSource(base); if(a.sourceFingerprint!=='be7f23501ec71b78974bc9f818fc75b46abfd0a4de0ad83288de7a49826c37cc')throw Error('A source mismatch');
const report=JSON.parse(await readFile(base+'/.next-web/release-assets.json'));
if((await readFile(base+'/.next-web/BUILD_ID','utf8')).trim()!=='b1c2adf31950c6f3db7ab189bbeabce29df5d6d9766418f3a9935bdde94f234b')throw Error('A build mismatch');
const config=await readFile(repo+'/next.config.js');if(hash(config)!=='047f4d6aa8546b21956b5c3f9bef5a7a3e8520b1e1fd7cf4f25d4a9d6fbe7892')throw Error('config mismatch');
const patch=await readFile(repo+'/perf/artifacts/use-press-chunk-experiment-hook-probe.patch');if(hash(patch)!=='412809b976a9e8e254b9d5c1b1bdd62a06287fd273f51369e1376db249376d86')throw Error('patch mismatch');
await mkdir(out);await writeFile(out+'/A-source-manifest.json',JSON.stringify(a,null,2));
await writeFile(out+'/A-release-assets.json',JSON.stringify(report,null,2));
const key=await readFile('/home/tim/.local/share/foremanhq-release/server-actions.key','utf8');
const common={node:process.versions.node,actionKeySha256:hash(key.trim()),dependencies:await realpath(base+'/node_modules'),active:await realpath(base+'/.next'),toolchain:report.toolchain};
for(const corner of ['B','C','D']){
 const dir=out+'/'+corner;await mkdir(dir);
 for(const name of ['src','public','scripts','vendor'])await cp(base+'/'+name,dir+'/'+name,{recursive:true});
 for(const name of ['next.config.js','postcss.config.js','package.json','pnpm-lock.yaml','tsconfig.json','next-env.d.ts'])await cp(base+'/'+name,dir+'/'+name);
 for(const name of ['node_modules','.next','.env'])await symlink(await realpath(base+'/'+name),dir+'/'+name);
 if(corner!=='B')await writeFile(dir+'/next.config.js',config);
 if(corner!=='C'){const p=spawnSync('git',['apply','--unsafe-paths','-'],{cwd:dir,input:patch,encoding:'utf8'});if(p.status)throw Error(p.stderr);}
 const m=await fingerprintSource(dir),am=new Map(a.manifest.map(x=>[x.name,x.sha256]));
 const changed=m.manifest.filter(x=>am.get(x.name)!==x.sha256).map(x=>x.name).sort();
 const expected=(corner==='B'?['src/hooks/use-press.ts']:corner==='C'?['next.config.js']:['next.config.js','src/hooks/use-press.ts']);
 if(JSON.stringify(changed)!==JSON.stringify(expected)||m.manifest.length!==a.manifest.length)throw Error('changed set '+corner);
 if(corner!=='C'&&hash(await readFile(dir+'/src/hooks/use-press.ts'))!=='03880145c211d93e4e8047aede9962d6eab6b023e53f5dfb5bd7ff3bc44c2e51')throw Error('probe postimage');
 await writeFile(out+'/'+corner+'-source-manifest.json',JSON.stringify({...m,changed,...common},null,2));
}
await writeFile(out+'/preflight.json',JSON.stringify({base,out,...common,publicFiles:a.manifest.filter(x=>x.name.startsWith('public/')).length,prepared:['B','C','D']},null,2));
console.log(out);
