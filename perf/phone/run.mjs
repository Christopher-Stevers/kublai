// Separate exploratory phone method. Never import/change the frozen lab driver.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance as hostClock } from "node:perf_hooks";
import { createCdpConnection } from "./cdp-transport.mjs";

const physicalMethod = "phone-visited-reads-page-cdp-v1";
const smoke = process.env.PERF_PHONE_SMOKE === "1";
const METHOD = smoke ? "local-smoke-visited-reads-page-cdp-v1" : physicalMethod;
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
      if (result.exceptionDetails)
        throw Error("Synthetic page evaluation failed; payload omitted");
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
    const textTarget = (text) =>
      `Array.from(document.querySelectorAll('a,button,[role="button"],[data-slot="card-title"],h1,h2,h3,h4,span,p,div')).find(el=>el.textContent.trim()===${JSON.stringify(text)}&&el.getClientRects().length&&!Array.from(el.children).some(child=>child.textContent.trim()===${JSON.stringify(text)}&&child.getClientRects().length))`;
    const jobCard = `Array.from(document.querySelectorAll('[data-job-card="material-lists"]')).find(el=>el.getClientRects().length)`;
    const listReady = `Array.from(document.querySelectorAll('button')).find(el=>el.getAttribute('aria-label')==='Increase quantity'&&el.getClientRects().length)`;
    const jobPath = `/jobs/${encodeURIComponent(fixture.jobId)}`;
    const listPath = `/jobs/material-lists/${encodeURIComponent(fixture.materialListId)}`;
    const journeys = [
      {
        name: "openjob",
        source: "/jobs",
        target: textTarget(fixture.jobName),
        ready: jobCard,
      },
      {
        name: "switchjobtabs",
        source: jobPath,
        target: jobCard,
        ready: textTarget(fixture.materialListName),
      },
      {
        name: "openmateriallist",
        source: `${jobPath}/material-lists`,
        target: textTarget(fixture.materialListName),
        ready: listReady,
      },
    ];
    async function tapRead(journey) {
      await until(`Boolean(${journey.target})`);
      const point = await own(
        `(() => {const el=(${journey.target});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
      );
      await own(`(() => {
    const state={start:null,release:null,gaps:[],last:null,done:false};
    let timeout;
    state.promise=new Promise((resolve,reject)=>{
      timeout=setTimeout(()=>{cleanup();reject(Error('Read readiness timeout'));},20000);
      const down=()=>{state.start=performance.now();performance.mark('phone-evidence:tap-start');requestAnimationFrame(tick);};
      const up=()=>{state.release=performance.now();};
      const cleanup=()=>{clearTimeout(timeout);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);};
      const tick=now=>{
        if(state.done)return;
        if(state.last!==null&&state.gaps.length<300)state.gaps.push(now-state.last);state.last=now;
        if(${journey.ready})requestAnimationFrame(()=>{
          state.done=true;cleanup();performance.measure('phone-evidence:read-to-paint-opportunity',{start:'phone-evidence:tap-start'});
          resolve({browserDurationMs:performance.now()-state.start,gestureHoldMs:state.release===null?null:state.release-state.start,frameGapsMs:state.gaps,appMeasures:performance.getEntriesByType('measure').filter(e=>e.startTime>=state.start&&['foremenhq:tap-to-paint','foremenhq:app-start-to-last-screen'].includes(e.name)).map(e=>({name:e.name,durationMs:e.duration})).slice(-20)});
        });else requestAnimationFrame(tick);
      };
      document.addEventListener('pointerdown',down,{capture:true,once:true});document.addEventListener('pointerup',up,{capture:true,once:true});
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
          setPhase("navigate", journey.name, run);
          await navigate(journey.source);
          setPhase("source-ready", journey.name, run);
          await until(`Boolean(${journey.target})`);
          setPhase("warmread", journey.name, run);
          await tapRead(journey); // Visit through the actual UI first.
          setPhase("back", journey.name, run);
          await own("(()=>{history.back();return true;})()");
          await until(
            `location.pathname===${JSON.stringify(journey.source)}&&Boolean(${journey.target})`,
          );
          setPhase("visitedread", journey.name, run);
          samples.push({
            journey: journey.name,
            run,
            ...(await tapRead(journey)),
          });
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
      report = {
        status: smoke ? "smoke-failed" : "failed",
        physicalPhoneEvidence: false,
        method: METHOD,
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
      if (report) report.cleanup = cleanup;
    }
    const output = path.resolve(
      process.env.PERF_PHONE_OUTPUT ??
        `perf/artifacts/phone-visited-reads-${Date.now()}.json`,
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
      `perf/artifacts/phone-setup-failed-${Date.now()}.json`,
  );
  const errorClass =
    error instanceof Error && /^[A-Za-z]+Error$/.test(error.name)
      ? error.name
      : "Error";
  const report = {
    status: smoke ? "smoke-setup-failed" : "setup-failed",
    method: METHOD,
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
