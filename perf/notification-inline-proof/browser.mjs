// Isolated component HTTP behavior only. No Next app, database, auth or timing gate.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import {FROZEN,verifyFrozen,resolveFrozen,sha} from "./prepare.mjs";
const require = createRequire(import.meta.url),
  esbuild = createRequire(require.resolve("tsx"))("esbuild");
// Parent supervisor owns one worker process group and the exact browser PID
// recorded by that worker. All outputs use an exclusive attempt directory.
if (!process.argv.includes("--worker")) {
  const directory = await fs.mkdtemp(
    path.resolve("perf/artifacts/notification-inline-http-attempt-"),
  );
  const worker = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "--worker"],
    {
      detached: true,
      stdio: "inherit",
      env: { ...process.env, NOTIFICATION_INLINE_OUTPUT: directory },
    },
  );
  const supervision = {
    deadlineMs: 90_000,
    killGraceMs: 3_000,
    timedOut: false,
    workerPid: worker.pid,
  };
  const stopBrowser = async () => {
    try {
      const own = JSON.parse(
        await fs.readFile(path.join(directory, "owned-browser.json"), "utf8"),
      );
      const stat = await fs.readFile(`/proc/${own.pid}/stat`, "utf8");
      const startTime = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
      if (startTime === own.startTime) {
        process.kill(-own.pid, "SIGKILL");
        supervision.browserForcedKill = true;
      }
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH")
        supervision.browserKillError = String(error);
    }
  };
  let killer;
  const deadline = setTimeout(() => {
    supervision.timedOut = true;
    try {
      process.kill(-worker.pid, "SIGTERM");
    } catch {}
    void stopBrowser();
    killer = setTimeout(() => {
      try {
        process.kill(-worker.pid, "SIGKILL");
      } catch {}
    }, 3_000);
  }, 90_000);
  const status = await new Promise((resolve) =>
    worker.once("exit", (code, signal) => resolve({ code, signal })),
  );
  clearTimeout(deadline);
  clearTimeout(killer);
  if (supervision.timedOut) {
    try {
      process.kill(-worker.pid, "SIGKILL");
      supervision.workerGroupForcedKill = true;
    } catch {}
  }
  await stopBrowser();
  try {
    const own = JSON.parse(
      await fs.readFile(path.join(directory, "owned-browser.json"), "utf8"),
    );
    const stat = await fs.readFile(`/proc/${own.pid}/stat`, "utf8");
    supervision.ownedBrowserAbsent =
      stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] !== own.startTime;
  } catch (error) {
    supervision.ownedBrowserAbsent = error.code === "ENOENT";
  }
  await fs.writeFile(
    path.join(directory, "supervisor.json"),
    JSON.stringify({ ...supervision, ...status }, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify({ attemptDirectory: directory, ...status }));
  process.exit(
    status.code === 0 && !supervision.timedOut && supervision.ownedBrowserAbsent
      ? 0
      : 1,
  );
}
const outputDirectory=process.env.NOTIFICATION_INLINE_OUTPUT;
if(!outputDirectory)throw Error('Owned supervisor output required');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'foremanhq-notification-inline-browser-'));
const methodFiles=['perf/notification-inline-proof/browser.mjs','perf/notification-inline-proof/prepare.mjs','perf/notification-inline-proof/app.jsx','perf/notification-inline-proof/api.jsx'];
const result={method:'notification-inline-frozen-component-http-v1',limits:['Exact frozen inline Center/Dialog/rows/filters/settings/read and owner hook with real QueryClient','Synthetic local transport/router and unrelated external push capability only','Not production auth, batching, app latency, full idle or activation evidence'],requests:[],checks:[],externalRequests:[],browserErrors:[],cleanup:{}};
let server,browserServer,browser,browserProcess,port;
const watchdog=setTimeout(()=>{result.watchdogExpired=true;void browserServer?.kill();server?.closeAllConnections();server?.close();},85_000);
try{
 result.frozen=await verifyFrozen();result.inputHashes={};
 for(const name of methodFiles)result.inputHashes[name]=sha(await fs.readFile(name));
 const require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('tsx'))('esbuild');
 const built=await esbuild.build({entryPoints:['perf/notification-inline-proof/app.jsx'],outfile:temp+'/app.js',bundle:true,format:'esm',platform:'browser',jsx:'automatic',metafile:true,define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'frozen-runtime-synthetic-transport',setup(build){
  build.onResolve({filter:/^~\//},async args=>args.path==='~/trpc/react'?{path:path.resolve('perf/notification-inline-proof/api.jsx')}:{path:await resolveFrozen(args.path)});
  build.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'external-capability-fixture'}));
  build.onResolve({filter:/^\.\/PushNotifications$/},args=>{if(args.importer===FROZEN+'/src/components/notifications/NotificationCenter.tsx')return{path:'push',namespace:'external-capability-fixture'};});
  build.onLoad({filter:/.*/,namespace:'external-capability-fixture'},args=>({contents:args.path==='router'?'export const useRouter=()=>({push(path){window.inlineNavigation.push(path)}});':'import React from "react";export function PushNotifications(){return <p>External push capability fixture</p>}',loader:'jsx',resolveDir:process.cwd()}));
 }}]});
 result.bundleSha256=sha(await fs.readFile(temp+'/app.js'));
 const frozenInputs=Object.keys(built.metafile.inputs).map(name=>path.resolve(name)).filter(name=>name.startsWith(FROZEN+'/'));
 for(const name of [...new Set(frozenInputs)].sort())result.inputHashes[name]=sha(await fs.readFile(name));
 assert.ok(frozenInputs.includes(FROZEN+'/src/components/notifications/NotificationCenter.tsx'));
 assert.ok(frozenInputs.includes(FROZEN+'/src/components/notifications/JobNotificationSettings.tsx'));
 assert.ok(frozenInputs.includes(FROZEN+'/src/hooks/use-notification-account.ts'));
 assert.equal(frozenInputs.some(name=>name.endsWith('/NotificationPanel.tsx')),false);
 const target={kind:'drawing',id:'11111111-1111-4111-8111-111111111111'};
 let unread=true,muted=false;
 const item=()=>({id:'drawing:synthetic',kind:'drawing',title:'Synthetic task',context:'Synthetic job',description:'Review fixture',createdAt:'2026-11-11T12:00:00Z',unread,url:'/jobs/synthetic/drawings',target});
 server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),name=url.pathname;
  if(req.method==='GET'&&name==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');return;}
  if(req.method==='GET'&&name==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(temp+'/app.js'));return;}
  const readNames=['identity','overview','list','jobSettings'],writeNames=['read','setJobSettings'],endpoint=name.slice('/fixture/'.length);
  if(!name.startsWith('/fixture/')||!(req.method==='GET'&&readNames.includes(endpoint)||req.method==='POST'&&writeNames.includes(endpoint))){res.statusCode=405;res.end();return;}
  let input;try{input=JSON.parse(url.searchParams.get('input'));}catch{res.statusCode=400;res.end();return;}
  const event={endpoint,method:req.method,input,startedMonotonic:performance.now(),finishedMonotonic:null};result.requests.push(event);
  setTimeout(()=>{
   let value;
   if(endpoint==='identity')value={accountKey:'synthetic:org'};
   else if(input?.accountKey!=='synthetic:org'){res.statusCode=409;value={message:'Synthetic account changed',code:'CONFLICT'};}
   else if(endpoint==='overview')value={accountKey:'synthetic:org',unreadCount:unread?1:0,readTargets:unread?[target]:[]};
   else if(endpoint==='list')value={accountKey:'synthetic:org',items:!input.unreadOnly||unread?[item()]:[],nextCursor:null};
   else if(endpoint==='jobSettings')value={accountKey:'synthetic:org',jobs:[{id:'synthetic-job',name:'Synthetic job',muted}]};
   else if(endpoint==='read'){if(JSON.stringify(input.targets)!==JSON.stringify([target])){res.statusCode=400;value={message:'Unexpected synthetic read target',code:'BAD_REQUEST'};}else{unread=false;value={ok:true};}}
   else if(endpoint==='setJobSettings'){muted=input.muted;value={ok:true};}
   event.finishedMonotonic=performance.now();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
  },250);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;const origin=`http://127.0.0.1:${port}`;result.origin=origin;
 browserServer=await chromium.launchServer({executablePath:'/usr/bin/chromium',headless:true});browserProcess=browserServer.process();const stat=await fs.readFile(`/proc/${browserProcess.pid}/stat`,'utf8');await fs.writeFile(outputDirectory+'/owned-browser.json',JSON.stringify({pid:browserProcess.pid,startTime:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]}),{flag:'wx'});browser=await chromium.connect(browserServer.wsEndpoint());
 const context=await browser.newContext();await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();result.externalRequests.push(route.request().method());return route.abort();});
 const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>result.browserErrors.push(String(e)));await page.goto(origin);
 await page.getByRole('button',{name:'Notifications, 1 unread'}).click();await page.getByRole('button',{name:/Synthetic task/}).waitFor();await page.getByRole('button',{name:'All',exact:true}).click();await expect(page.getByRole('button',{name:'All',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>result.requests.some(e=>e.endpoint==='list'&&e.input.unreadOnly===false&&e.finishedMonotonic!==null)).toBe(true);
 await page.evaluate(()=>{window.originalInlineDialog=document.querySelector('[role="dialog"]');});
 await page.getByRole('button',{name:'Notification settings',exact:true}).click();await page.getByRole('switch',{name:'Synthetic job notifications'}).waitFor();
 const finished=name=>result.requests.filter(e=>e.endpoint===name&&e.finishedMonotonic!==null).length;
 await expect.poll(()=>finished('overview'),{timeout:65000,intervals:[100]}).toBe(4);
 const cycles=result.requests.filter(e=>e.endpoint==='overview');assert.equal(cycles.length,4);
 const gaps=[cycles[2].startedMonotonic-cycles[1].startedMonotonic,cycles[3].startedMonotonic-cycles[2].startedMonotonic],span=cycles[3].startedMonotonic-cycles[1].startedMonotonic;
 assert.ok(gaps.every(ms=>ms>=29000));assert.ok(span>=59000);assert.equal(finished('identity'),1);
 await expect(page.getByRole('dialog',{name:'Notification settings'})).toBeVisible();assert.equal(await page.evaluate(()=>window.originalInlineDialog===document.querySelector('[role="dialog"]')),true);
 result.checks.push({name:'Two real30s overview cycles/250ms replies retain actual inline settings dialog with bootstrap identity only',gapsMs:gaps,spanMs:span,identityReplies:finished('identity'),overviewReplies:finished('overview'),pass:true});
 await page.getByRole('switch',{name:'Synthetic job notifications'}).click();await expect(page.getByRole('switch',{name:'Synthetic job notifications'})).toHaveAttribute('aria-checked','false');
 await page.getByRole('button',{name:'Back to notifications'}).click();await expect(page.getByRole('button',{name:'All',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:/Synthetic task/}).waitFor();
 await page.getByRole('button',{name:'Mark all read'}).click();await expect(page.getByRole('button',{name:'Mark all read'})).toBeDisabled();await expect.poll(()=>finished('read')).toBe(1);await expect(page.locator('button[aria-label="Notifications"]')).toHaveCount(1);
 await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('button',{name:'Notifications',exact:true}).click();await expect(page.getByRole('button',{name:'All',exact:true})).toHaveAttribute('aria-pressed','true');
 await context.setOffline(true);await expect(page.getByRole('dialog',{name:'Notifications'})).toBeVisible();await context.setOffline(false);await expect.poll(()=>finished('identity')).toBeGreaterThanOrEqual(2);
 await page.evaluate(()=>window.inlineFixture.setActive(false));await page.evaluate(()=>window.inlineFixture.setActive(true));await expect.poll(()=>finished('identity')).toBeGreaterThanOrEqual(3);
 await expect(page.getByRole('button',{name:'All',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:/Synthetic task/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);assert.deepEqual(await page.evaluate(()=>window.inlineNavigation),['/jobs/synthetic/drawings']);
 result.checks.push({name:'Actual All filter, job settings switch, read ACK, Close/reopen, offline/pause resume and read-row navigation preserved',pass:true});
 assert.equal(result.browserErrors.length,0);assert.equal(result.externalRequests.length,0);assert.equal(result.watchdogExpired,undefined);result.status='PASS';
}catch(error){result.status='FAIL';result.error=String(error.stack??error);process.exitCode=1;}
finally{
 clearTimeout(watchdog);
 try{await browser?.close();await browserServer?.close();result.cleanup.browserClosed=true;result.cleanup.browserProcessExited=!browserProcess||browserProcess.exitCode!==null||browserProcess.signalCode!==null;}catch(e){result.cleanup.browserError=String(e);process.exitCode=1;}
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));result.cleanup.serverClosed=true;result.cleanup.boundPortClosed=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(false)});socket.once('error',e=>resolve(e.code==='ECONNREFUSED'));socket.once('timeout',()=>{socket.destroy();resolve(false)});});if(!result.cleanup.boundPortClosed){result.status='FAIL';process.exitCode=1;}}
 await fs.rm(temp,{recursive:true,force:true});result.cleanup.tempRemoved=true;
 try{result.frozenAfter=await verifyFrozen();result.inputHashesAfter={};for(const name of Object.keys(result.inputHashes??{}))result.inputHashesAfter[name]=sha(await fs.readFile(name));result.sourcesUnchanged=JSON.stringify(result.inputHashes)===JSON.stringify(result.inputHashesAfter);if(!result.sourcesUnchanged){result.status='FAIL';process.exitCode=1;}}catch(e){result.sourceAfterError=String(e);result.status='FAIL';process.exitCode=1;}
 await fs.writeFile(outputDirectory+'/report.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
}
