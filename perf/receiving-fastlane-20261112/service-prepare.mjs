// Operational-only: original source/test files are never overwritten.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const proposal=new URL('./',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
const [mode,treeArg,evidenceArg]=process.argv.slice(2);
const tree=await fs.realpath(treeArg),evidence=await fs.realpath(evidenceArg);
assert.equal(path.dirname(tree),'/home/tim/.openclaw/workspace/releases');
assert.match(path.basename(tree),/^speed-phase0-receiving-rc-validation-[A-Za-z0-9_-]+$/);
await fs.access(path.join(tree,'PERF_LAB_ONLY'));
const generatedTest='src/server/packing-slips/receiving-rc-private.integration.test.ts';
const generatedGuard='src/server/packing-slips/receiving-rc-private-client.ts';
const config='receiving-rc-private.vitest.mts';
const generated=[generatedTest,generatedGuard,config];
const {fingerprintSource}=await import('../../scripts/release/source-fingerprint.mjs');
if(mode==='finish'){
  for(const name of generated)await fs.rm(path.join(tree,name),{force:true});
  const before=JSON.parse(await fs.readFile(path.join(evidence,'source-before.json'),'utf8'));
  const after=await fingerprintSource(tree);
  assert.equal(after.sourceFingerprint,before.sourceFingerprint);
  await fs.writeFile(path.join(evidence,'source-after.json'),JSON.stringify(after,null,2));
}else{
  assert.equal(mode,'prepare');
  const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',proposal)));
  const validation=JSON.parse(await fs.readFile(new URL('validation-manifest.json',proposal)));
  assert.deepEqual(manifest.failures,[]);assert.deepEqual(validation.failures,[]);
  const identity=JSON.parse(await fs.readFile(path.join(tree,'RECEIVING_RC_SOURCE.json'),'utf8'));
  assert.equal(identity.mode,'validation-only');
  for(const [name,record] of Object.entries({...manifest.runtimePaths,...validation.testPaths}))
    assert.equal(sha(await fs.readFile(path.join(tree,name))),record.postimage,name);
  const schema='src/server/db/schema.ts';
  assert.equal(sha(await fs.readFile(path.join(tree,schema))),sha(await fs.readFile(path.join(manifest.baseSource,schema))));
  const before=await fingerprintSource(tree);
  assert.equal(before.sourceFingerprint,identity.sourceFingerprint);
  for(const name of generated){try{await fs.access(path.join(tree,name));throw Error('Generated destination already exists')}catch(error){if(error.code!=='ENOENT')throw error}}
  await fs.writeFile(path.join(evidence,'source-before.json'),JSON.stringify(before,null,2),{flag:'wx'});
  let test=await fs.readFile(path.join(tree,'src/server/packing-slips/service.integration.test.ts'),'utf8');
  const replace=(old,next)=>{assert.equal(test.split(old).length,2,'Exact safety transform match');test=test.replace(old,next)};
  replace('  host: socket ?? "/tmp/no-packing-db",','  host: socket ?? "/tmp/no-packing-db",\n  user: "receiving_rc_fixture",\n  ssl: false,\n  fetch_types: false,');
  // Empty lookup joins: preserve schema column types, omit unused defaults.
  replace('  beforeAll(async () => {','  beforeAll(async () => {\n    await assertPrivateClient(conn);\n    for (const table of [schema.categories, schema.materials, schema.sizes]) {\n      const columns = Object.values(getTableColumns(table)).map(c => `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}`);\n      await conn.unsafe(`CREATE TABLE "${getTableName(table)}" (${columns.join(",")})`);\n    }');
  test='import { assertPrivateClient } from "./receiving-rc-private-client";\n'+test;
  await fs.writeFile(path.join(tree,generatedTest),test,{flag:'wx'});
  await fs.copyFile(new URL('service-client-guard.ts',proposal),path.join(tree,generatedGuard),fs.constants.COPYFILE_EXCL);
  const content=`import {defineConfig} from 'vitest/config';\nexport default defineConfig({test:{include:['${generatedTest}'],environment:'node',maxWorkers:1,fileParallelism:false,testTimeout:30000,hookTimeout:30000},resolve:{alias:{'~':${JSON.stringify(path.join(tree,'src'))}}}});\n`;
  await fs.writeFile(path.join(tree,config),content,{flag:'wx'});
  const methods={};for(const name of generated)methods[name]=sha(await fs.readFile(path.join(tree,name)));
  await fs.writeFile(path.join(evidence,'generated-method.json'),JSON.stringify(methods,null,2),{flag:'wx'});
}
