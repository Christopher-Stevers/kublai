import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
test('delta gate excludes retained history and rejects excess bytes and URL collisions', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'script-delta-'));
  const before=path.join(root,'before'),after=path.join(root,'after');
  try {
    for(const dir of [before,after]) { await mkdir(path.join(dir,'static'),{recursive:true}); await writeFile(path.join(dir,'static/common.js'),'console.log("same")'); }
    const manifest=(dir,hash,names)=>writeFile(path.join(dir,'release-assets.json'),JSON.stringify({sourceHash:hash.repeat(64),currentScripts:names}));
    await manifest(before,'a',['common.js']);await manifest(after,'b',['common.js']);
    await writeFile(path.join(after,'static/retained-old.js'),'old retained file');
    const run=()=>spawnSync(process.execPath,[new URL('./check-small-change.mjs',import.meta.url).pathname,before,after],{encoding:'utf8'});
    let result=run();assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).changedScripts,0);
    await writeFile(path.join(after,'static/new.js'),'/*'+randomBytes(200000).toString('hex')+'*/');
    await manifest(after,'b',['common.js','new.js']);result=run();assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).passes,false);
    await writeFile(path.join(after,'static/common.js'),'different bytes at immutable URL');
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/URL collision/);
  } finally { await rm(root,{recursive:true}); }
});
