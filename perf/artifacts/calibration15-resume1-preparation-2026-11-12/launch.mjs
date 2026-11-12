// Operational resume only: frozen measurement harness/session remain untouched.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const [planFile,expected]=process.argv.slice(2);
const raw=fs.readFileSync(planFile,'utf8');assert.equal(sha(raw),expected);
const p=JSON.parse(raw),repo='/home/tim/.openclaw/workspace/kublai';
assert.equal(sha(fs.readFileSync(fileURLToPath(import.meta.url))),p.launchSha256);
const {withDeployLock}=await import(repo+'/scripts/release/dev-deploy.mjs');
const {verifyFrozenHarness}=await import(p.harnessRoot+'/perf/harness-fingerprint.mjs');
const {evaluateCalibrationProgress}=await import(p.harnessRoot+'/perf/calibrated-policy.mjs');
assert.equal((await verifyFrozenHarness(p.harnessRoot)).harnessFingerprint,p.harnessFingerprint);
assert.equal(sha(fs.readFileSync(p.sessionPlan)),p.sessionPlanSha256);
const registry=repo+'/.perf-active-run.json';
await withDeployLock(repo,async()=>{
  assert(!fs.existsSync(registry),'Existing registered runtime must be reviewed');
  assert(!fs.existsSync(p.record)&&!fs.existsSync(p.log)&&!fs.existsSync(p.spoiledStage));
  const bundle=JSON.parse(fs.readFileSync(p.sessionRoot+'/calibration.json'));
  assert.equal(bundle.status,'incomplete');assert.equal(bundle.controls.length,5);
  assert.deepEqual(evaluateCalibrationProgress(bundle).errors,[]);
  assert.equal(new Date(Date.parse(bundle.startedAt)+180000000).toISOString(),p.originalDeadline);
  for(const [name,digest]of Object.entries(p.completedFiles))assert.equal(sha(fs.readFileSync(path.join(p.sessionRoot,name))),digest,name);
  // Root already stopped the old outer; never signal an unrecorded process.
  const old=JSON.parse(fs.readFileSync(p.priorOuterRecord));
  assert(old.familyAbsent&&old.ownedIdentitiesAbsent);
  for(const identity of old.processes){
    try{const current=fs.readFileSync(`/proc/${identity.pid}/stat`,'utf8').split(')').at(-1).trim().split(/\s+/);assert.notEqual(current[19],identity.startTime,'Prior owned PID identity survives');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const interrupted=JSON.parse(fs.readFileSync(p.interruptedStage+'/report.json'));
  assert.equal(interrupted.samples.length,p.interruptedSampleCount);
  assert(!bundle.controls.some(c=>JSON.parse(c.plan.raw).captureId.endsWith('C06')));
  const retained={};
  const walk=(dir,prefix='')=>{for(const item of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const name=path.join(prefix,item.name),full=path.join(dir,item.name);assert(!item.isSymbolicLink());if(item.isDirectory())walk(full,name);else if(item.isFile())retained[name]=sha(fs.readFileSync(full));}};
  walk(p.interruptedStage);
  const remaining=Math.floor((Date.parse(p.originalDeadline)-Date.now())/1000);
  assert(remaining>4500,'No fresh stage without original 75-minute budget');
  const interruption={reason:'dev-deploy-priority',status:'spoiled-repeat-later',rawReportStatusUnchanged:true,originalStage:p.interruptedStage,retainedStage:p.spoiledStage,interruptedSampleCount:p.interruptedSampleCount,retainedFileSha256:retained,originalDeadline:p.originalDeadline,recordedAt:new Date().toISOString()};
  fs.writeFileSync(p.interruptionRecord,JSON.stringify(interruption,null,2)+'\n',{flag:'wx',mode:0o600});
  fs.renameSync(p.interruptedStage,p.spoiledStage);
  const command=['python3',p.harnessRoot+'/perf/lab/owned-process-supervisor.py','run','--seconds',String(remaining),'--record',p.record,'--',process.execPath,p.harnessRoot+'/perf/calibration-orchestrator.mjs',p.sessionPlan,p.sessionPlanSha256,'19'];
  const log=fs.openSync(p.log,'wx',0o600);
  const child=spawn(command[0],command.slice(1),{cwd:repo,detached:true,stdio:['ignore',log,log]});
  let spawned=false;
  try{
    await new Promise((resolve,reject)=>{child.once('spawn',()=>{spawned=true;resolve()});child.once('error',reject)});
    const until=Date.now()+10000;let owner;
    while(Date.now()<until){if(fs.existsSync(p.record)){owner=JSON.parse(fs.readFileSync(p.record));if(owner.status==='running')break;}await new Promise(r=>setTimeout(r,50));}
    assert(owner?.status==='running','Outer owner did not register running');
    assert.equal(owner.supervisor.pid,child.pid);
    const registration={version:1,sessionId:p.sessionId,sessionRoot:p.sessionRoot,ownershipRecord:p.record};
    fs.writeFileSync(registry,JSON.stringify(registration,null,2)+'\n',{flag:'wx',mode:0o600});
    fs.writeFileSync(p.launchRecord,JSON.stringify({startedAt:new Date().toISOString(),command,remainingSeconds:remaining,originalDeadline:p.originalDeadline,supervisor:owner.supervisor,root:owner.root,registry:registration,completedFiles:p.completedFiles},null,2)+'\n',{flag:'wx',mode:0o600});
    child.unref();
  }catch(error){
    if(spawned){const {spawnSync}=await import('node:child_process');spawnSync('python3',[p.harnessRoot+'/perf/lab/owned-process-supervisor.py','stop','--record',p.record],{timeout:20000});}
    throw error;
  }finally{fs.closeSync(log);}
});
