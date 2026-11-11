import {test} from 'node:test';import assert from 'node:assert/strict';import {inspectProviders,providerInventory,checkProviders} from './shared-providers.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import {spawnSync} from 'node:child_process';
const file='src/app/layout.tsx';const base="import {ThemeProvider} from '~/components/ThemeProvider';export default function Layout({children}){return <ThemeProvider>{children}</ThemeProvider>}";
const sources=(text=base,extra=[])=>new Map([[file,text],...extra]);const initial=providerInventory(inspectProviders(sources()));
test('counts exact provider import and usage; ordinary components are not providers',()=>{
 const rows=inspectProviders(sources(base.replace('<ThemeProvider>','<ThemeProvider><Header/>').replace('</ThemeProvider>','</ThemeProvider>')));assert.equal(rows.length,2);
 assert.equal(inspectProviders(sources("import {Header} from '~/Header';export default ()=> <Header/>;")).length,0);
});
test('new provider in old root/jobs layout, unused provider import and duplicate mount fail',()=>{
 for(const source of [base+";import {ExtraProvider} from '~/ExtraProvider';",base.replace('>{children}<','>{children}<ThemeProvider/><')])assert.ok(checkProviders(inspectProviders(sources(source)),initial).violations.length);
 const extra=[['src/app/jobs/layout.tsx',base]];assert.equal(checkProviders(inspectProviders(sources(base,extra)),initial).violations.length,2);
});
test('line shifts, provider aliases and changed provider internals preserve the same public identity',()=>{
 const alias=base.replaceAll('ThemeProvider','Alias').replace("{Alias}","{ThemeProvider as Alias}").replace("~/components/Alias","~/components/ThemeProvider");
 assert.equal(checkProviders(inspectProviders(sources('\n// shifted\n'+alias)),initial).violations.length,0);
 assert.equal(checkProviders(inspectProviders(sources(base,[['src/components/ThemeProvider.tsx',"export function ThemeProvider({children}){return <NewEngineProvider>{children}</NewEngineProvider>}"]])),initial).violations.length,0);
});
test('changing canonical provider source/export fails even with unchanged JSX alias',()=>{
 for(const text of [base.replace("~/components/ThemeProvider","~/other/ThemeProvider"),base.replace('{ThemeProvider}', '{OtherProvider as ThemeProvider}')])assert.ok(checkProviders(inspectProviders(sources(text)),initial).violations.length);
});
test('follows ordinary shared wrappers with children; a new provider behind an existing wrapper fails',()=>{
 const layout="import {Shell} from './shell';export default ({children})=><Shell>{children}</Shell>";
 const shell="export function Shell({children}){return <main>{children}</main>}";
 const before=sources(layout,[['src/app/shell.tsx',shell]]),baseline=providerInventory(inspectProviders(before));
 before.set('src/app/shell.tsx',"import {ExtraProvider as Hidden} from '~/ExtraProvider';export function Shell({children}){return <Hidden>{children}</Hidden>}");
 assert.equal(checkProviders(inspectProviders(before),baseline).violations.length,2);
});
test('follows local component aliases, context.Provider and React19 direct context providers',()=>{
 const a=inspectProviders(sources("import {ThemeProvider} from '~/ThemeProvider';const Local=ThemeProvider;export default ({children})=><Local>{children}</Local>"));assert.equal(a.length,2);assert.equal(a[1].export,'ThemeProvider');
 const b=inspectProviders(sources("const Ctx=createContext(null);export default ({children})=><Ctx.Provider value={null}>{children}</Ctx.Provider>"));assert.equal(b.length,1);assert.equal(b[0].export,'Ctx.Provider');
 const c=inspectProviders(sources("const Ctx=createContext(null);export default ({children})=><Ctx value={null}>{children}</Ctx>"));assert.equal(c.length,1);
});
test('deleted imports/paths pass; retired identities cannot be reintroduced; exceptions need a reason',()=>{
 assert.equal(checkProviders([],initial).violations.length,0);
 const retired={...initial,entries:[],retired:initial.entries.map(e=>({...e,reason:'Removed from shared layout; keep this identity retired.'}))};assert.equal(checkProviders(inspectProviders(sources()),retired).violations.length,2);
 assert.throws(()=>checkProviders([], {...initial,entries:initial.entries.map(e=>({...e,reason:''}))}));
});
test('a feature leaf provider is outside the common children wrapper traversal',()=>{
 const layout="import {Feature} from './feature';export default ({children})=><><Feature/>{children}</>";
 assert.equal(inspectProviders(sources(layout,[['src/app/feature.tsx',"import {LocalProvider} from '~/LocalProvider';export const Feature=()=> <LocalProvider/>;"]])).length,0);
});
test('CLI rejects a real new layout provider and accepts its reviewed exact exception',async()=>{
 const root=await mkdtemp('/tmp/shared-provider-test-');try{
 await mkdir(path.join(root,'src/app'),{recursive:true});await writeFile(path.join(root,file),base);
 const baselinePath=path.join(root,'baseline.json');await writeFile(baselinePath,JSON.stringify(initial));
 const run=()=>spawnSync(process.execPath,['--input-type=module','-e',`import {checkSharedProviders} from ${JSON.stringify(new URL('../check-providers.mjs',import.meta.url).href)};await checkSharedProviders(${JSON.stringify(root)},${JSON.stringify(baselinePath)});`],{encoding:'utf8'});
 assert.equal(run().status,0);await writeFile(path.join(root,file),base.replaceAll('ThemeProvider','NewProvider'));assert.equal(run().status,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('namespace and relative provider aliases retain canonical identity',()=>{
 const absolute="import {ThemeProvider} from '~/components/ThemeProvider';export default ({children})=><ThemeProvider>{children}</ThemeProvider>";
 const baseline=providerInventory(inspectProviders(sources(absolute)));
 const relative=absolute.replace('~/components/ThemeProvider','../components/ThemeProvider');
 assert.equal(checkProviders(inspectProviders(sources(relative)),baseline).violations.length,0);
 const namespace="import * as UI from '~/components/ThemeProvider';export default ({children})=><UI.ThemeProvider>{children}</UI.ThemeProvider>";
 // Namespace itself is not a provider import; its exact provider mount is gated.
 assert.equal(checkProviders(inspectProviders(sources(namespace)),baseline).violations.length,0);
 assert.ok(checkProviders(inspectProviders(sources(namespace.replace('UI.ThemeProvider','UI.NewProvider').replace('UI.ThemeProvider','UI.NewProvider'))),baseline).violations.length);
});
test('real lint/build entrypoints reject new providers before output work',async()=>{
 const root=await mkdtemp('/tmp/shared-provider-preflight-');try{
 await mkdir(path.join(root,'src/app'),{recursive:true});await writeFile(path.join(root,file),base);
 for(const [script,args,env] of [['../check-lint.mjs',[],{}],['../release/build.mjs',[path.join(root,'output')],{RELEASE_SOURCE_DIR:root}]]){
  const result=spawnSync(process.execPath,[new URL(script,import.meta.url).pathname,...args],{cwd:root,env:{...process.env,...env},encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Shared-layout provider speed-law gate failed/);
 }
 const {existsSync}=await import('node:fs');assert.equal(existsSync(path.join(root,'output')),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
