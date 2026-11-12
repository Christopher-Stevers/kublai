// Source-prepared only. Execute solely after root releases calibration quiet.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base='/home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112';
const proposal=new URL('./',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function prepareUnits(){
 const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',proposal)));
 const candidate=await fs.readFile(new URL('runtime/NotificationCenter.tsx',proposal));
 const sourcePath='src/components/notifications/NotificationCenter.tsx';
 assert.equal(sha(candidate),manifest.runtimePaths[sourcePath].postimage);
 assert.equal(sha(await fs.readFile(base+'/'+sourcePath)),manifest.runtimePaths[sourcePath].preimage);
 const {fingerprintSource}=await import('/tmp/foremanhq-perf-method-f9bHR6/scripts/release/source-fingerprint.mjs');
 assert.equal((await fingerprintSource(base)).sourceFingerprint,manifest.baseFingerprint);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'foremanhq-notification-closure-units-'));
 await fs.symlink(base+'/node_modules',directory+'/node_modules');
 await fs.writeFile(directory+'/package.json','{"type":"module"}\n');
 // Selected file sits at the disposable root. Resolve its three relative
 // notification dependencies explicitly to active-source aliases, which also
 // match the existing inline test's PushNotifications capability mock. These
 // test-only import rewrites and export suffix never enter runtime.patch.
 const relativeImportRewrites=['use-notification-reminder','PushNotifications','JobNotificationSettings'].map(name=>({from:'"./'+name+'"',to:'"~/components/notifications/'+name+'"'}));
 let testSource=candidate.toString('utf8');
 for(const rewrite of relativeImportRewrites){
  assert.equal(testSource.split(rewrite.from).length-1,1,'Expected exact selected relative import '+rewrite.from);
  testSource=testSource.replace(rewrite.from,rewrite.to);
 }
 const exportSuffix='\nexport { useNotificationAccount };\n';
 testSource+=exportSuffix;
 await fs.writeFile(directory+'/NotificationCenter.tsx',testSource);
 const setup=execFileSync('git',['show','669d7f83:vitest.setup.ts']);
 assert.equal(sha(setup),'91a3c8962a0edcb956206a501d943fe99e1c78c6d4d8b5c9a948a3362c75978c');
 await fs.writeFile(directory+'/vitest.setup.ts',setup);
 let owners=execFileSync('git',['show','acca100a:src/hooks/use-notification-account.test.tsx'],{encoding:'utf8'});
 owners=owners.replaceAll('"./use-notification-account"','"~/hooks/use-notification-account"').replaceAll('"./use-online-status"','"~/hooks/use-online-status"');
 await fs.writeFile(directory+'/owner.test.tsx',owners);
 // The exact previously reviewed six actual INLINE UI tests, not lazy-panel
 // substitutes. Their transport/capability mocks remain explicit.
 const inline=execFileSync('git',['show','fc8e99ab:perf/notification-inline-proof/inline.test.tsx']);
 await fs.writeFile(directory+'/inline.test.tsx',inline);
 await fs.writeFile(directory+'/tsconfig.json',JSON.stringify({extends:base+'/tsconfig.json'})+'\n');
 const selected=directory+'/NotificationCenter.tsx';
 const config=`import{defineConfig}from'vitest/config';export default defineConfig({root:${JSON.stringify(directory)},server:{fs:{allow:[${JSON.stringify(base)},${JSON.stringify(directory)}]}},test:{environment:'jsdom',setupFiles:['./vitest.setup.ts'],include:['*.test.tsx']},resolve:{alias:[{find:'~/components/notifications/NotificationCenter',replacement:${JSON.stringify(selected)}},{find:'~/hooks/use-notification-account',replacement:${JSON.stringify(selected)}},{find:'~',replacement:${JSON.stringify(base+'/src')}}]}});`;
 await fs.writeFile(directory+'/vitest.config.mjs',config);
 const result={baseSource:base,baseFingerprint:manifest.baseFingerprint,runtimePostimage:sha(candidate),testOnlyTransforms:{relativeImportRewrites,exportSuffix,preparedSelectedSourceSha256:sha(Buffer.from(testSource))},sourceMocks:'Transport, online/simulation test seams and unrelated external push only; actual inline rows/Dialog/settings/filter/read/Close',tests:{ownerSource:'acca100a',ownerSha256:sha(Buffer.from(owners)),inlineSource:'fc8e99ab',inlineSha256:sha(inline)},directory,executed:false};
 await fs.writeFile(directory+'/manifest.json',JSON.stringify(result,null,2)+'\n');
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname)console.log(JSON.stringify(await prepareUnits()));
