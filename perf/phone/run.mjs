// Separate exploratory phone method. Never import/change the frozen lab driver.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance as hostClock } from "node:perf_hooks";
import { createCdpConnection } from "./cdp-transport.mjs";

const physicalMethod = "phone-visited-reads-page-cdp-v5-diagnostic-v1";
const smoke = process.env.PERF_PHONE_SMOKE === "1";
const METHOD = smoke
  ? "local-smoke-visited-reads-page-cdp-v5-diagnostic-v1"
  : physicalMethod;
let setupPhase = "configuration";
const setupEvidence = { createdTargetKnown: false };
async function main() {
  const boundedFetch = (url, options = {}) =>
    fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  function loopback(value, label) {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw Error(
        `${label} must be an explicit loopback HTTP origin with port`,
      );
    return url;
  }
  const host = loopback(
    process.env.PERF_PHONE_HOST_BASE,
    "PERF_PHONE_HOST_BASE",
  );
  const base = loopback(process.env.PERF_PHONE_BASE, "PERF_PHONE_BASE");
  const debug = loopback(process.env.PERF_PHONE_CDP, "PERF_PHONE_CDP");
  const transport = process.env.PERF_PHONE_CONTROL_TRANSPORT;
  if (
    smoke
      ? transport !== "local-smoke"
      : !["adb-wifi", "adb-usb"].includes(transport)
  )
    throw Error(
      "Use explicit adb-wifi/adb-usb, or local-smoke only with PERF_PHONE_SMOKE=1",
    );
  const root = await fs.realpath(process.env.PERF_PHONE_LAB_ROOT);
  const pg = await fs.realpath(process.env.PERF_LAB_SOCKET);
  if (!pg.startsWith("/tmp/foremanhq-perf-pg."))
    throw Error("Private lab database observation path required");
  const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
  const source = await readJson(path.join(root, "source-evidence.json"));
  const preflight = await readJson(path.join(root, "preflight.json"));
  const fixture = await readJson(path.join(root, "perf/fixtures.json"));
  setupEvidence.sourceBuild = source.sourceBuild;
  setupEvidence.sourceFingerprint = source.sourceFingerprint;
  const inventory = await readJson(path.join(pg, "schema-inventory.json"));
  if (
    !/^[a-f0-9]{64}$/.test(source.sourceFingerprint) ||
    !source.sourceBuild ||
    preflight.status !== "passed" ||
    preflight.sourceFingerprint !== source.sourceFingerprint ||
    preflight.sourceBuild !== source.sourceBuild ||
    preflight.build !== process.env.PERF_BUILD ||
    !Array.isArray(inventory.tables) ||
    !inventory.tables.length ||
    fixture.userId !== "perf-lab-user" ||
    fixture.provenance !== "isolated-seeded-app" ||
    fixture.productionDatabase !== false
  )
    throw Error(
      "Source-bound synthetic preflight/private schema evidence required",
    );
  for (const key of ["jobId", "jobName", "materialListId", "materialListName"])
    if (typeof fixture[key] !== "string" || !fixture[key])
      throw Error(`Missing synthetic ${key}`);
  const assertLab = (value) => {
    if (
      value?.provenance !== "isolated-seeded-app" ||
      value.productionDatabase !== false ||
      value.authentication !== "stubbed-seeded-user" ||
      value.userId !== "perf-lab-user"
    )
      throw Error("Isolated synthetic app attestation failed");
  };
  setupPhase = "host-attestation";
  assertLab(
    await boundedFetch(new URL("/api/perf-lab", host), {
      redirect: "error",
    }).then((r) => {
      if (!r.ok) throw Error("Lab attestation unavailable");
      return r.json();
    }),
  );
  async function databaseHealth() {
    const log = await fs.readFile(path.join(pg, "server.log"), "utf8");
    return {
      errors: (log.match(/^\d{4}-\d{2}-\d{2}.*?\bERROR:/gm) ?? []).length,
      fatals: (log.match(/^\d{4}-\d{2}-\d{2}.*?\bFATAL:/gm) ?? []).length,
    };
  }
  setupPhase = "database-health";
  const beforeHealth = await databaseHealth();
  if (beforeHealth.errors || beforeHealth.fatals)
    throw Error("Private database health must be clean before phone evidence");
  const repeats = Number(process.env.PERF_PHONE_RUNS ?? 2);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5)
    throw Error("Exploratory phone runs must be 1..5");
  const creation = process.env.PERF_PHONE_TARGET_CREATION ?? "http-new";
  if (!["http-new", "browser-create-target"].includes(creation))
    throw Error("Unsupported explicit target creation mode");
  setupEvidence.targetCreation = creation;
  let created;
  if (creation === "browser-create-target") {
    setupPhase = "browser-metadata";
    const metadata = await boundedFetch(new URL("/json/version", debug), {
      redirect: "error",
    }).then((response) => {
      if (!response.ok) throw Error("Chrome metadata unavailable");
      return response.json();
    });
    const advertised = new URL(metadata.webSocketDebuggerUrl);
    if (
      advertised.protocol !== "ws:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(advertised.hostname) ||
      !/^\/devtools\/browser(?:\/[a-z0-9-]+)?$/i.test(advertised.pathname) ||
      advertised.search ||
      advertised.hash
    )
      throw Error("Invalid browser control endpoint");
    const controlUrl = new URL(advertised.pathname, debug);
    controlUrl.protocol = "ws:";
    setupPhase = "browser-target-create";
    // Exactly one browser command: create our blank target. Never discover or
    // auto-attach existing targets; close this control socket after its reply.
    const control = new WebSocket(controlUrl);
    let targetId;
    try {
      targetId = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Target creation timeout")),
          10000,
        );
        const fail = () => {
          clearTimeout(timer);
          reject(Error("Browser creation connection failed"));
        };
        control.addEventListener("error", fail, { once: true });
        control.addEventListener("close", fail, { once: true });
        control.addEventListener(
          "open",
          () =>
            control.send(
              JSON.stringify({
                id: 1,
                method: "Target.createTarget",
                params: { url: "about:blank" },
              }),
            ),
          { once: true },
        );
        control.addEventListener("message", ({ data }) => {
          const reply = JSON.parse(String(data));
          if (reply.id !== 1) return;
          clearTimeout(timer);
          if (reply.error || !reply.result?.targetId)
            reject(Error("Chrome rejected explicit target creation"));
          else resolve(reply.result.targetId);
        });
      });
    } finally {
      try {
        control.close();
      } catch {
        /* No target discovery recovery. */
      }
    }
    if (!/^[a-z0-9-]+$/i.test(targetId))
      throw Error("Invalid created target identifier");
    const pageSocket = new URL(`/devtools/page/${targetId}`, debug);
    pageSocket.protocol = "ws:";
    created = {
      id: targetId,
      type: "page",
      url: "about:blank",
      webSocketDebuggerUrl: pageSocket.href,
    };
  } else {
    setupPhase = "http-target-create";
    created = await boundedFetch(new URL("/json/new?about:blank", debug), {
      method: "PUT",
      redirect: "error",
    }).then((response) => {
      if (!response.ok)
        throw Error(
          "Chrome rejected HTTP target creation; use an explicitly approved creation mode",
        );
      return response.json();
    });
  }

  if (
    created.type !== "page" ||
    created.url !== "about:blank" ||
    !/^[a-z0-9-]+$/i.test(created.id)
  )
    throw Error("New blank page target required");
  setupEvidence.createdTargetKnown = true;
  let cleanupResult;
  const closeCreatedTarget = async () => {
    if (cleanupResult) return cleanupResult;
    try {
      const response = await boundedFetch(
        new URL(`/json/close/${created.id}`, debug),
      );
      cleanupResult = {
        method: "http-close-created-id",
        acknowledged: response.ok,
        httpStatus: response.status,
      };
    } catch (error) {
      cleanupResult = {
        method: "http-close-created-id",
        acknowledged: false,
        errorClass: error instanceof Error ? error.name : "Error",
      };
    }
    setupEvidence.cleanup = cleanupResult;
    return cleanupResult;
  };
  let socket, connection;
  try {
    const wsUrl = new URL(created.webSocketDebuggerUrl);
    if (
      wsUrl.protocol !== "ws:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(wsUrl.hostname) ||
      wsUrl.port !== debug.port ||
      wsUrl.pathname !== `/devtools/page/${created.id}`
    )
      throw Error("Only the newly created page WebSocket is allowed");
    setupPhase = "page-websocket-open";
    socket = new WebSocket(wsUrl);
    connection = createCdpConnection(socket);
    await connection.ready;
    const send = (method, params = {}) => connection.send(method, params);
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        const description = result.exceptionDetails.exception?.description;
        for (const label of [
          "Ambiguous synthetic control",
          "Destination visible before input",
          "Destination visible before timed input",
          "Read readiness timeout",
          "Synthetic target did not settle",
        ])
          if (typeof description === "string" && description.includes(label))
            throw Error(label);
        throw Error("Synthetic page evaluation failed; payload omitted");
      }
      return result.result.value;
    };
    const own = (expression) =>
      evaluate(
        `(() => {if(location.origin!==${JSON.stringify(base.origin)})throw Error('Unexpected page origin');return (${expression});})()`,
      );
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let phase = { stage: "attestation", journey: null, run: null };
    const setPhase = (stage, journey = null, run = null) => {
      phase = { stage, journey, run };
    };
    async function until(expression) {
      const deadline = hostClock.now() + 30_000;
      while (hostClock.now() < deadline) {
        if (await own(expression)) return;
        await pause(50);
      }
      throw Error(
        `Synthetic readiness timeout [${phase.stage}:${phase.journey ?? "initial"}:${phase.run ?? "-"}]`,
      );
    }
    async function navigate(route) {
      const target = new URL(route, base);
      if (target.origin !== base.origin)
        throw Error("Only synthetic-origin navigation is allowed");
      await send("Page.navigate", { url: target.href });
      // Only this newly created target is inspected. Its initial blank document
      // may remain while the first loopback navigation loads.
      const deadline = hostClock.now() + 30_000;
      while ((await evaluate("location.origin")) !== base.origin) {
        if (hostClock.now() > deadline)
          throw Error("New synthetic target did not load");
        await pause(50);
      }
      await until(
        `location.href===${JSON.stringify(target.href)}&&document.readyState==='complete'`,
      );
    }
    // Fail closed on duplicate visible controls; headings are never job inputs.
    const uniqueVisible = (selector, predicate = "true") =>
      `(() => {const matches=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(el=>el.getClientRects().length&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden'&&(${predicate}));if(matches.length>1)throw Error('Ambiguous synthetic control');return matches[0];})()`;
    const namedCard = (selector, name) =>
      uniqueVisible(
        selector,
        `Array.from(el.querySelectorAll('[data-slot="card-title"]')).some(title=>title.textContent.trim()===${JSON.stringify(name)})`,
      );
    const jobSource = namedCard(
      '[data-tutorial="job-card"][role="button"]',
      fixture.jobName,
    );
    const listSource = namedCard(
      '[data-slot="card"]',
      fixture.materialListName,
    );
    const jobCard = uniqueVisible('[data-job-card="material-lists"]');
    const appBack = uniqueVisible('button[aria-label="Go up one level"]');
    const listReady = `Array.from(document.querySelectorAll('button')).find(el=>el.getAttribute('aria-label')==='Increase quantity'&&el.getClientRects().length)`;
    const jobPath = `/jobs/${encodeURIComponent(fixture.jobId)}`;
    const listPath = `/jobs/material-lists/${encodeURIComponent(fixture.materialListId)}`;
    const journeys = [
      {
        name: "openjob",
        source: "/jobs",
        target: jobSource,
        ready: jobCard,
      },
      {
        name: "switchjobtabs",
        source: jobPath,
        target: jobCard,
        ready: listSource,
      },
      {
        name: "openmateriallist",
        source: `${jobPath}/material-lists`,
        target: listSource,
        ready: listReady,
      },
    ];
    async function settlePoint(targetExpression) {
      return own(`(async () => {
        const el=(${targetExpression});
        if(!el)throw Error('Synthetic target did not settle');
        el.scrollIntoView({behavior:'instant',block:'center',inline:'nearest'});
        return await new Promise((resolve,reject)=>{
          let frame,previous=null,stable=0,finished=false;
          const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);cancelAnimationFrame(frame);error?reject(error):resolve(value);};
          const timer=setTimeout(()=>finish(Error('Synthetic target did not settle')),1500);
          const tick=()=>{
            try {
              if(!el.isConnected||!el.getClientRects().length)return finish(Error('Synthetic target did not settle'));
              const r=el.getBoundingClientRect(),v=visualViewport;
              const current=[r.x,r.y,r.width,r.height,scrollX,scrollY,innerWidth,innerHeight,v?.offsetLeft??0,v?.offsetTop??0,v?.width??innerWidth,v?.height??innerHeight];
              const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
              const interactive=hit?.closest('a,button,input,select,textarea,[role="button"],[role="menuitem"]');
              const contained=!!hit&&el.contains(hit),nested=!!interactive&&interactive!==el;
              const valid=r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&contained&&!nested;
              stable=valid&&previous&&current.every((value,index)=>Math.abs(value-previous[index])<=0.5)?stable+1:0;
              previous=valid?current:null;
              if(stable>=2)return finish(null,{x,y,timeOrigin:performance.timeOrigin,targetContainsHit:contained,nestedInteractiveHit:nested,stableFrames:3});
              frame=requestAnimationFrame(tick);
            }catch {finish(Error('Synthetic target did not settle'));}
          };
          frame=requestAnimationFrame(tick);
        });
      })()`);
    }
    async function returnToSource(journey) {
      await until(`Boolean(${appBack})`);
      const settledBack = await settlePoint(appBack);
      const backPoint = { x: settledBack.x, y: settledBack.y };
      await send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [backPoint],
      });
      await send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await until(
        `location.pathname===${JSON.stringify(journey.source)}&&Boolean(${journey.target})&&!Boolean(${journey.ready})`,
      );
    }
    let activeReadProbe = null;
    let activeJourney = null;
    async function probeFailedRead() {
      const journey = activeReadProbe?.journey ?? activeJourney;
      if (!journey) return null;
      const preTouch = activeReadProbe?.preTouch ?? null;
      const destination =
        journey.name === "openmateriallist"
          ? listPath
          : journey.name === "switchjobtabs"
            ? `${jobPath}/material-lists`
            : "/jobs";
      let timer;
      try {
        const after = await Promise.race([
          own(`(() => {const state=window.__phoneReadEvidence;return {
            sourcePathMatches:location.pathname===${JSON.stringify(journey.source)},
            destinationPathMatches:location.pathname===${JSON.stringify(destination)},
            timeOriginChanged:${preTouch ? `performance.timeOrigin!==${JSON.stringify(preTouch.timeOrigin)}` : "null"},
            targetVisible:Boolean(${journey.target}),readyVisible:Boolean(${journey.ready}),
            evidenceExists:!!state,startSeen:state?.start!=null,releaseSeen:state?.release!=null,done:state?.done===true,inputMetadata:state?.input??null
          };})()`),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("Failure probe unavailable")),
              1500,
            );
          }),
        ]);
        return { preTouch, after };
      } catch {
        return { preTouch, after: { probeUnavailable: true } };
      } finally {
        clearTimeout(timer);
      }
    }
    async function tapRead(journey) {
      await until(`Boolean(${journey.target})`);
      await own(
        `(() => {if(${journey.ready})throw Error('Destination visible before input');return true;})()`,
      );
      const preTouch = await settlePoint(journey.target);
      const point = { x: preTouch.x, y: preTouch.y };
      activeReadProbe = { journey, preTouch };
      await own(`(() => {
    if(${journey.ready})throw Error('Destination visible before timed input');
    const sourceTarget=(${journey.target});
    const contained=event=>event.target instanceof Node&&!!sourceTarget?.contains(event.target);
    const state={start:null,release:null,gaps:[],last:null,done:false,input:{downTrusted:false,upTrusted:false,downTargetContained:false,upTargetContained:false,pointercancelSeen:false,clickSeen:false,clickTargetContained:false,scrollDuringTouch:0}};
    let timeout;
    state.promise=new Promise((resolve,reject)=>{
      timeout=setTimeout(()=>{cleanup();reject(Error('Read readiness timeout'));},20000);
      const down=event=>{state.input.downTrusted=event.isTrusted;state.input.downTargetContained=contained(event);try{if(${journey.ready})throw Error('Destination visible before input');state.start=performance.now();performance.mark('phone-evidence:tap-start');requestAnimationFrame(tick);}catch(error){state.done=true;cleanup();reject(error);}};
      const up=event=>{state.input.upTrusted=event.isTrusted;state.input.upTargetContained=contained(event);state.release=performance.now();};
      const cancel=event=>{if(event.isTrusted)state.input.pointercancelSeen=true;};
      const click=event=>{if(event.isTrusted){state.input.clickSeen=true;state.input.clickTargetContained=contained(event);}};
      const scroll=()=>{if(state.start!==null&&state.release===null)state.input.scrollDuringTouch++;};
      const cleanup=()=>{clearTimeout(timeout);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',cancel,true);document.removeEventListener('click',click,true);window.removeEventListener('scroll',scroll,true);};
      const tick=now=>{
        if(state.done)return;
        if(state.last!==null&&state.gaps.length<300)state.gaps.push(now-state.last);state.last=now;
        if(${journey.ready})requestAnimationFrame(()=>{
          state.done=true;cleanup();performance.measure('phone-evidence:read-to-paint-opportunity',{start:'phone-evidence:tap-start'});
          resolve({inputMetadata:{...state.input},browserDurationMs:performance.now()-state.start,gestureHoldMs:state.release===null?null:state.release-state.start,frameGapsMs:state.gaps,appMeasures:performance.getEntriesByType('measure').filter(e=>e.startTime>=state.start&&['foremenhq:tap-to-paint','foremenhq:app-start-to-last-screen'].includes(e.name)).map(e=>({name:e.name,durationMs:e.duration})).slice(-20)});
        });else requestAnimationFrame(tick);
      };
      document.addEventListener('pointerdown',down,{capture:true,once:true});document.addEventListener('pointerup',up,{capture:true,once:true});document.addEventListener('pointercancel',cancel,true);document.addEventListener('click',click,true);window.addEventListener('scroll',scroll,true);
    });
    window.__phoneReadEvidence=state;return true;
  })()`);
      const started = hostClock.now();
      await send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: point.x, y: point.y }],
      });
      await send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      const browser = await own("window.__phoneReadEvidence.promise");
      activeReadProbe = null;
      return { ...browser, driverWallclockMs: hostClock.now() - started };
    }
    let report;
    const samples = [];
    try {
      await send("Page.enable");
      await send("Runtime.enable");
      setPhase("activate-new-page");
      await send("Page.bringToFront");
      setPhase("attestation");
      await navigate("/api/perf-lab");
      assertLab(
        await own(`(async () => {
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
    try {const response=await fetch('/api/perf-lab',{redirect:'error',cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('Phone attestation unavailable');return await response.json();}
    finally {clearTimeout(timeout);}
  })()`),
      );
      const deviceRuntime = await own(
        "({userAgent:navigator.userAgent,devicePixelRatio,screen:{width:screen.width,height:screen.height},viewport:{width:innerWidth,height:innerHeight},hardwareConcurrency:navigator.hardwareConcurrency})",
      );
      for (const journey of journeys)
        for (let run = 0; run < repeats; run++) {
          activeJourney = journey;
          activeReadProbe = null;
          setPhase("navigate", journey.name, run);
          await navigate(journey.source);
          setPhase("initial-normalization", journey.name, run);
          await until(`Boolean(${journey.target})||Boolean(${journey.ready})`);
          if (await own(`Boolean(${journey.ready})`)) {
            await returnToSource(journey);
          }
          setPhase("source-ready", journey.name, run);
          await until(`Boolean(${journey.target})`);
          setPhase("warmread", journey.name, run);
          await tapRead(journey); // Visit through the actual UI first.
          setPhase("back", journey.name, run);
          await returnToSource(journey);
          setPhase("visitedread", journey.name, run);
          samples.push({
            journey: journey.name,
            run,
            ...(await tapRead(journey)),
          });
          // Leave the workspace at its source before the next same-URL visit;
          // /jobs intentionally restores its saved local destination on reload.
          setPhase("reset-after-sample", journey.name, run);
          await returnToSource(journey);
        }
      const afterHealth = await databaseHealth();
      if (
        afterHealth.errors !== beforeHealth.errors ||
        afterHealth.fatals !== beforeHealth.fatals
      )
        throw Error("Private database health changed during phone evidence");
      report = {
        status: smoke ? "smoke-only" : "diagnostic-only",
        physicalPhoneEvidence: !smoke,
        method: METHOD,
        navigationPreparation:
          "instant-stable-hit-then-app-header-normalize-and-back-unique-source-destination-absent",
        timestamp: new Date().toISOString(),
        driverSha256: createHash("sha256")
          .update(await fs.readFile(new URL(import.meta.url)))
          .digest("hex"),
        transportSha256: createHash("sha256")
          .update(
            await fs.readFile(new URL("./cdp-transport.mjs", import.meta.url)),
          )
          .digest("hex"),
        sourceBuild: source.sourceBuild,
        sourceFingerprint: source.sourceFingerprint,
        controlTransport: transport,
        targetCreation: creation,
        cpu: smoke
          ? "natural-host-no-throttling"
          : "natural-device-no-throttling",
        network: smoke
          ? "host-loopback-lab"
          : "unshaped-adb-reverse-loopback-lab",
        input: "page-scoped-CDP-touch-events",
        deviceRuntime,
        deviceModel: smoke
          ? "not-a-phone-local-smoke"
          : (process.env.PERF_PHONE_DEVICE_MODEL ?? "unconfirmed"),
        refreshRateHz: null,
        thermalState: process.env.PERF_PHONE_THERMAL_NOTE ?? "unrecorded",
        databaseHealth: { before: beforeHealth, after: afterHealth },
        samples,
        limitations: [
          "Exploratory device/browser timing, not physical pixel/compositor proof",
          "Not the accepted v2 lab method or the 8x3 journey/link matrix",
          "Driver wallclock and touch hold include ADB control latency; browser rAF readiness is a paint opportunity",
          "No link shaping, offline test, CPU emulation, production writes, cookies, target listing or browser-wide trace",
        ],
      };
    } catch (error) {
      const failureDiagnostics = await probeFailedRead();
      report = {
        status: smoke ? "smoke-failed" : "failed",
        failureDiagnostics,
        physicalPhoneEvidence: false,
        method: METHOD,
        navigationPreparation:
          "instant-stable-hit-then-app-header-normalize-and-back-unique-source-destination-absent",
        timestamp: new Date().toISOString(),
        sourceBuild: source.sourceBuild,
        sourceFingerprint: source.sourceFingerprint,
        controlTransport: transport,
        targetCreation: creation,
        phase,
        completedSamples: samples,
        completedSamplesDiagnosticOnly: true,
        error: error instanceof Error ? error.message : "Phone evidence failed",
        ...(typeof error?.kind === "string" ? { errorKind: error.kind } : {}),
        ...(Number.isInteger(error?.code) ? { errorCode: error.code } : {}),
        accepted: false,
      };
    } finally {
      connection.close();
      const cleanup = await closeCreatedTarget();
      if (report) {
        report.cleanup = cleanup;
        report.supplementalDiagnosticOnly = true;
        report.accepted = false;
      }
    }
    const output = path.resolve(
      process.env.PERF_PHONE_OUTPUT ??
        `perf/artifacts/phone-v5-diagnostic-v1-visited-reads-${Date.now()}.json`,
    );
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.log(`Exploratory phone evidence saved: ${output}`);
    if (["failed", "smoke-failed"].includes(report.status))
      process.exitCode = 1;
  } finally {
    try {
      if (connection) connection.close();
      else socket?.close();
    } catch {
      /* Still close only our explicit target. */
    }
    // This ID came only from the explicitly created and validated blank page.
    await closeCreatedTarget();
  }
}
await main().catch(async (error) => {
  // Setup may fail before there is a known target/session. Record bounded
  // metadata only; never enumerate targets to recover an unknown create result.
  const output = path.resolve(
    process.env.PERF_PHONE_OUTPUT ??
      `perf/artifacts/phone-v2-setup-failed-${Date.now()}.json`,
  );
  const errorClass =
    error instanceof Error && /^[A-Za-z]+Error$/.test(error.name)
      ? error.name
      : "Error";
  const report = {
    status: smoke ? "smoke-setup-failed" : "setup-failed",
    method: METHOD,
    navigationPreparation:
      "instant-stable-hit-then-app-header-normalize-and-back-unique-source-destination-absent",
    physicalPhoneEvidence: false,
    accepted: false,
    timestamp: new Date().toISOString(),
    phase: { stage: setupPhase },
    controlTransport:
      process.env.PERF_PHONE_CONTROL_TRANSPORT ?? "unconfigured",
    ...setupEvidence,
    errorClass,
    completedSamples: [],
    completedSamplesDiagnosticOnly: true,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.error(`Diagnostic setup failure saved: ${output}`);
  process.exitCode = 1;
});
