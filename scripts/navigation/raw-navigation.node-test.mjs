import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectSources, inventory, checkRows } from './raw-navigation.mjs';
const rows = (text,file='src/Old.tsx')=>inspectSources(new Map([[file,text]]));
const source = `const router={push:()=>{}}; const destination='/jobs'; function open(){router.push(destination)}; export function View(){return <button onClick={open}>Jobs</button>}`;
const baseline=inventory(rows(source));
test('detects inline route, location, workspace, state and named local navigation',()=>{
 for(const action of [`router.push('/jobs')`,`router.replace('/jobs')`,`window.location.href='/jobs'`,`location.assign('/jobs')`,`navigateWorkspace('job')`,`setActiveTab('drawings')`]) assert.equal(rows(`const View=()=> <div onClick={()=>{${action}}}/>;`).length,1,action);
 assert.equal(rows(source).length,1);
});
test('allows imported shared primitives and aliases, but not name lookalikes',()=>{
 for(const declaration of ["import {Button} from '~/components/ui/button'", "import {Button as Safe} from '~/components/ui/button'", "import {PressableCard as Safe} from '~/components/ui/pressable-card'", "import Safe from 'next/link'", "import {Button as Safe} from './components/ui/button'"]) {
  const tag=declaration.includes(' as Safe')||declaration.includes('import Safe')?'Safe':'Button';
  assert.equal(rows(`${declaration};const View=()=> <${tag} onClick={()=>router.push('/jobs')}/>;`).length,0,declaration);
 }
 assert.equal(rows("const Button='button';const View=()=> <Button onClick={()=>router.push('/jobs')}/>;").length,1);
});
test('leaves non-navigation writes, manual controls and keyboard-only actions alone',()=>{
 assert.equal(rows("const View=()=> <><button onClick={()=>deleteRecord()}/><button onClick={()=>save()}/><div onKeyDown={()=>router.push('/jobs')}/></>;").length,0);
});
test('line shifts/comments/formatting do not invalidate an exact existing handler',()=>{
 assert.equal(checkRows(rows('\n\n// new heading\n'+source.replace("router.push(destination)","router . push ( destination ) /* comment */")),baseline).violations.length,0);
});
test('new handlers in an old file and copied handlers exceed the exact baseline count',()=>{
 const next=source.replace('</button>','</button>');
 assert.equal(checkRows(rows(next+";const New=()=> <div onClick={()=>router.push('/new')}/>"),baseline).violations.length,1);
 assert.equal(checkRows(rows(source+";const New=()=> <button onClick={open}/>"),baseline).violations.length,1);
});
test('editing a baselined expression, named implementation or referenced destination fails',()=>{
 for(const changed of [source.replace('onClick={open}',"onClick={()=>router.push('/other')}"),source.replace('push(destination)','replace(destination)'),source.replace("destination='/jobs'","destination='/other'")]) assert.equal(checkRows(rows(changed),baseline).violations.length,1);
});
test('unrelated sibling changes and deleting paths/handlers pass; moving to a new path fails',()=>{
 assert.equal(checkRows(rows(source+';const unrelated=2;'),baseline).violations.length,0);
 assert.equal(checkRows([],baseline).violations.length,0);
 assert.equal(checkRows(rows(source,'src/New.tsx'),baseline).violations.length,1);
});
test('manual/destructive/keyboard exceptions require an exact digest/count and written reason',()=>{
 for(const category of ['manual','keyboard','destructive']) {
  const exception=structuredClone(baseline); exception.entries[0].category=category;exception.entries[0].reason='Keep release-only confirmation before navigation; reviewed narrow exception.';
  assert.equal(checkRows(rows(source),exception).violations.length,0);
  assert.equal(checkRows(rows(source.replace("'/jobs'","'/new'")),exception).violations.length,1);
  exception.entries[0].reason='';assert.throws(()=>checkRows(rows(source),exception));
 }
});
test('CLI exits nonzero for a real new handler and zero for exact inventory/deleted paths',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'navigation-gate-'));
 try{
  await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src/Old.tsx'),source);
  // Exercise the exact CLI through the exported entry with a test-owned baseline.
  await writeFile(path.join(root,'baseline.json'),JSON.stringify(baseline));
  const run=()=>spawnSync(process.execPath,['--input-type=module','-e',`import {checkNavigation} from ${JSON.stringify(new URL('../check-navigation.mjs',import.meta.url).href)}; await checkNavigation(${JSON.stringify(root)},${JSON.stringify(path.join(root,'baseline.json'))});`],{encoding:'utf8'});
  assert.equal(run().status,0);
  await writeFile(path.join(root,'src/Old.tsx'),source.replace("destination='/jobs'","destination='/changed'"));assert.equal(run().status,1);
  await rm(path.join(root,'src/Old.tsx'));assert.equal(run().status,0);
 } finally {await rm(root,{recursive:true,force:true});}
});
test('router hook aliases and direct method handlers are covered; imports cannot be spoofed',()=>{
 assert.equal(rows("const nav=useRouter();const View=()=> <button onClick={()=>nav.push('/jobs')}/>;").length,1);
 assert.equal(rows("const View=()=> <button onClick={router.back}/>;").length,1);
 assert.equal(rows("import {Button} from '~/components/ui/button';function View(){const Button='button';return <Button onClick={()=>router.push('/jobs')}/>}").length,1);
});
test('lint and release entrypoints fail on new raw navigation before lint/build output work',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'navigation-preflight-'));
 try{
  await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src/New.tsx'),"export const View=()=> <button onClick={()=>router.push('/jobs')}/>;");
  const lint=spawnSync(process.execPath,[new URL('../check-lint.mjs',import.meta.url).pathname],{cwd:root,encoding:'utf8'});
  assert.notEqual(lint.status,0);assert.match(lint.stderr,/Raw navigation speed-law gate failed/);
  const build=spawnSync(process.execPath,[new URL('../release/build.mjs',import.meta.url).pathname,path.join(root,'output')],{cwd:root,env:{...process.env,RELEASE_SOURCE_DIR:root},encoding:'utf8'});
  assert.notEqual(build.status,0);assert.match(build.stderr,/Raw navigation speed-law gate failed/);
  const {existsSync}=await import('node:fs');assert.equal(existsSync(path.join(root,'output')),false);assert.equal(existsSync(path.join(root,'.next-release-build')),false);
 }finally {await rm(root,{recursive:true,force:true});}
});
