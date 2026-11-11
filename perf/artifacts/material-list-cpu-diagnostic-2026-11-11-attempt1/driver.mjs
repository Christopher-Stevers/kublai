// Supplemental visited-read profiling only. Not acceptance timing evidence.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { verifyFrozenHarness } from "./harness-fingerprint.mjs";
import { READ_PREFLIGHT_PROCEDURES, budgets } from "./check.mjs";
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = path.resolve(config.outputDirectory);
fs.mkdirSync(out, { recursive: true });
const driver = fileURLToPath(import.meta.url);
const sha = (p) =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const frozen = await verifyFrozenHarness(config.harnessRoot);
if (
  frozen.harnessFingerprint !==
  "25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4"
)
  throw Error("Wrong frozen method");
const expected = {
  baseline: [
    "c25f525d3a4755145e22b9977b300607209034ff59196ee170cbe219cf2c2e5d",
    "128da6e7cd4b35dce132d543a56ed673f8dce30fae56f7456b1fc3d94f5e8dd2",
  ],
  candidate: [
    "c49e8cbad84665aadc57323448c013f7c2420fa9cdff3992835164913bb7f161",
    "3d4e7376001274a418390701935b8f474d6973a6ae4f8976ede74fd62e7c1c0d",
  ],
};
const report = {
  protocol: "material-list-cpu-diagnostic-v1",
  acceptedGateEvidence: false,
  status: "incomplete",
  startedAt: new Date().toISOString(),
  driverSha256: sha(driver),
  methodFingerprint: frozen.harnessFingerprint,
  profile: {
    link: "Basement",
    cpuSlowdown: 4,
    visited: true,
    samplingIntervalUs: 1000,
    maxCaptureMs: 3000,
    maxTraceBytes: 20 * 1024 ** 2,
    maxCpuBytes: 5 * 1024 ** 2,
    maxTotalBytes: 55 * 1024 ** 2,
  },
  sources: {},
  samples: [],
  limitations: [
    "One profiled navigation/build; no significance or acceptance timing claim.",
    "Sampling and timeline instrumentation perturb execution.",
    "DOM readiness and two rAF are paint opportunities, not hardware presentation.",
    "Minified sample names may not identify React components or render/commit phases.",
    "Passive work later than100ms after readiness is omitted; frame sampling can miss tiny layout callbacks.",
  ],
};
const write = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
const health = (s) => {
  const t = fs.readFileSync(s.databaseLog, "utf8");
  return {
    errors: (t.match(/^.*\bERROR:/gm) ?? []).length,
    fatals: (t.match(/^.*\bFATAL:/gm) ?? []).length,
  };
};
const bounded = (p, ms, label) => {
  let t;
  return Promise.race([
    p,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(t));
};
let browser, context;
write();
try {
  for (const role of ["baseline", "candidate"]) {
    const s = config[role],
      base = new URL(s.base);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
      base.pathname !== "/" ||
      base.protocol !== "http:"
    )
      throw Error("Loopback root required");
    const evidence = JSON.parse(fs.readFileSync(s.sourceEvidence)),
      preflight = JSON.parse(fs.readFileSync(s.preflight)),
      fixture = JSON.parse(fs.readFileSync(s.fixtures));
    if (
      evidence.sourceBuild !== expected[role][0] ||
      evidence.sourceFingerprint !== expected[role][1] ||
      preflight.status !== "passed" ||
      preflight.sourceBuild !== evidence.sourceBuild ||
      preflight.sourceFingerprint !== evidence.sourceFingerprint ||
      preflight.build !== s.expectedLabBuild ||
      READ_PREFLIGHT_PROCEDURES.some(
        (p) =>
          !preflight.results.some(
            (r) => r.procedure === p && r.status === "ok",
          ),
      )
    )
      throw Error("Source/preflight mismatch");
    const attestation = await fetch(new URL("/api/perf-lab", base), {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    }).then((r) => {
      if (!r.ok) throw Error("Attestation HTTP");
      return r.json();
    });
    if (
      attestation.provenance !== "isolated-seeded-app" ||
      attestation.productionDatabase !== false ||
      fixture.provenance !== "isolated-seeded-app" ||
      fixture.productionDatabase !== false
    )
      throw Error("Synthetic fixture required");
    const serverPid = fs.readFileSync(s.serverPid, "utf8").trim();
    if (
      !/^\d+$/.test(serverPid) ||
      fs.realpathSync(`/proc/${serverPid}/cwd`) !== s.snapshot
    )
      throw Error("Server cwd mismatch");
    const env = new Map(
      fs
        .readFileSync(`/proc/${serverPid}/environ`, "utf8")
        .split("\0")
        .map((x) => {
          const i = x.indexOf("=");
          return [x.slice(0, i), x.slice(i + 1)];
        }),
    );
    const db = new URL(env.get("PERF_LAB_DATABASE_URL"));
    const socket = path.dirname(s.databaseLog);
    if (
      !socket.startsWith("/tmp/foremanhq-perf-pg.") ||
      db.pathname !== "/foremanhq_perf_lab" ||
      db.searchParams.get("host") !== socket ||
      db.searchParams.get("port") !== "55463" ||
      env.get("DATABASE_URL") !== env.get("PERF_LAB_DATABASE_URL") ||
      env.get("BIM_WORKER_DISABLED") !== "1"
    )
      throw Error("Private server database binding mismatch");
    const before = health(s);
    if (before.errors || before.fatals) throw Error("Database unhealthy");
    report.sources[role] = {
      sourceBuild: evidence.sourceBuild,
      sourceFingerprint: evidence.sourceFingerprint,
      labBuild: preflight.build,
      preflight,
      healthBefore: before,
      snapshot: s.snapshot,
      serverPid: Number(serverPid),
      privateDatabaseBindingVerified: true,
    };
    process.env.PERF_FIXTURES = s.fixtures;
    s.adapter = await import(
      pathToFileURL(path.join(config.harnessRoot, "perf/journeys.mjs")).href +
        `?material-cpu=${role}`
    );
    s.base = base;
    s.fixture = fixture;
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  report.browserVersion = browser.version();
  for (const role of ["baseline", "candidate"]) {
    const s = config[role];
    report.active = { role, phase: "prepare" };
    write();
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const denied = [];
    const requests = {};
    await context.route("**/*", async (route) => {
      const r = route.request(),
        u = new URL(r.url()),
        method = r.method();
      let emptyPush = false;
      if (
        method === "POST" &&
        /^\/api\/replicache\/[^/]+\/push$/.test(u.pathname)
      ) {
        try {
          const body = r.postDataJSON();
          emptyPush =
            Array.isArray(body?.mutations) && body.mutations.length === 0;
        } catch {
          /* Reject unparseable/nonempty pushes. */
        }
      }
      const safe =
        u.origin === s.base.origin &&
        (["GET", "HEAD"].includes(method) ||
          (method === "POST" &&
            u.pathname === "/api/replicache/material-lists/pull") ||
          emptyPush);
      if (!safe && !["data:", "blob:"].includes(u.protocol)) {
        denied.push({
          method,
          path: u.origin === s.base.origin ? u.pathname : "external-origin",
        });
        return route.abort("blockedbyclient");
      }
      const key = `${method} ${u.pathname.startsWith("/api/trpc/") ? u.pathname : "/non-rpc"}`;
      requests[key] = (requests[key] ?? 0) + 1;
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.enable");
    const p = budgets.links.Basement;
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: p.latencyMs,
      downloadThroughput: p.bytesPerSecond,
      uploadThroughput: p.bytesPerSecond,
    });
    await bounded(
      s.adapter.prepare({
        page,
        base: s.base.href,
        journey: "openmateriallist",
      }),
      60000,
      "Preparation timeout",
    );
    if (denied.length)
      throw Error("Read-only request guard rejected preparation");
    const target = page
      .getByText(s.fixture.materialListName, { exact: true })
      .first();
    const ready = page.getByRole("button", {
      name: "Increase quantity",
      exact: true,
    });
    await expect(target).toBeVisible();
    if (await ready.count()) throw Error("Destination already present");
    const sourceCount = await page
      .getByText(s.fixture.materialListName, { exact: true })
      .count();
    if (sourceCount !== 1) throw Error("Ambiguous source");
    await page.evaluate(() => {
      const d = { pointerdown: [], click: [], ready: null };
      const observe = () => {
        const n = [
          ...document.querySelectorAll(
            'button[aria-label="Increase quantity"]',
          ),
        ].filter((x) => x.getClientRects().length).length;
        if (n && d.ready === null) {
          d.ready = { at: performance.now(), count: n };
          performance.mark("material-cpu:ready");
        }
      };
      const pointer = (e) => {
        if (e.isTrusted) {
          d.pointerdown.push(performance.now());
          performance.mark("material-cpu:pointerdown");
        }
      };
      const click = (e) => {
        if (e.isTrusted) {
          d.click.push(performance.now());
          performance.mark("material-cpu:click");
        }
      };
      const observer = new MutationObserver(observe);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      document.addEventListener("pointerdown", pointer, true);
      document.addEventListener("click", click, true);
      window.__materialCpu = {
        finish: () => {
          observer.disconnect();
          document.removeEventListener("pointerdown", pointer, true);
          document.removeEventListener("click", click, true);
          return {
            ...d,
            quantityCount: [
              ...document.querySelectorAll(
                'button[aria-label="Increase quantity"]',
              ),
            ].filter((x) => x.getClientRects().length).length,
          };
        },
      };
    });
    const requestBefore = { ...requests };
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
    let completed;
    const done = new Promise((resolve) => {
      completed = resolve;
    });
    cdp.once("Tracing.tracingComplete", completed);
    await cdp.send("Tracing.start", {
      categories: "devtools.timeline,v8,blink.user_timing",
      transferMode: "ReturnAsStream",
      options: "record-as-much-as-possible",
    });
    await cdp.send("Profiler.start");
    report.active.phase = "capture";
    write();
    let cpu, traceStream, captureError;
    const started = performance.now();
    try {
      await bounded(
        (async () => {
          await target.click();
          await expect(ready.first()).toBeVisible();
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame((first) =>
                  requestAnimationFrame((second) => {
                    performance.mark("material-cpu:two-raf");
                    resolve({ first, second });
                  }),
                ),
              ),
          );
          await page.waitForTimeout(100);
        })(),
        3000,
        "Capture timeout",
      );
    } catch (error) {
      captureError = error;
    } finally {
      const stopped = await bounded(
        cdp.send("Profiler.stop"),
        3000,
        "CPU stop timeout",
      );
      cpu = stopped.profile;
      await bounded(cdp.send("Tracing.end"), 3000, "Trace stop timeout");
      traceStream = (await bounded(done, 3000, "Trace completion timeout"))
        .stream;
    }
    const captureMs = performance.now() - started;
    const cpuText = JSON.stringify(cpu);
    if (Buffer.byteLength(cpuText) > report.profile.maxCpuBytes)
      throw Error("CPU profile size bound");
    fs.writeFileSync(path.join(out, `${role}.cpuprofile`), cpuText);
    let total = 0;
    const traceFile = path.join(out, `${role}.trace.json`),
      fd = fs.openSync(traceFile, "w");
    try {
      for (;;) {
        const chunk = await bounded(
          cdp.send("IO.read", { handle: traceStream, size: 1024 * 1024 }),
          3000,
          "Trace read timeout",
        );
        const buf = Buffer.from(
          chunk.data,
          chunk.base64Encoded ? "base64" : "utf8",
        );
        total += buf.length;
        if (total > report.profile.maxTraceBytes)
          throw Error("Trace size bound");
        fs.writeSync(fd, buf);
        if (chunk.eof) break;
      }
    } finally {
      fs.closeSync(fd);
      await cdp.send("IO.close", { handle: traceStream });
    }
    const observed = await page.evaluate(() => window.__materialCpu.finish());
    const row = {
      role,
      captureMs,
      observed,
      requestsBeforeCapture: requestBefore,
      requestsAfterCapture: requests,
      denied,
      files: { cpu: `${role}.cpuprofile`, trace: `${role}.trace.json` },
      bytes: { cpu: Buffer.byteLength(cpuText), trace: total },
      profileNodes: cpu.nodes.length,
      samples: cpu.samples?.length ?? 0,
    };
    report.samples.push(row);
    write();
    if (captureError) throw captureError;
    if (captureMs > 3000) throw Error("Capture exceeded3s including stop");
    if (
      denied.length ||
      !observed.pointerdown.length ||
      !observed.click.length ||
      observed.ready === null
    )
      throw Error("Observation/read guard failed");
    await context.close();
    context = undefined;
  }
  report.status = "complete";
  delete report.active;
} catch (error) {
  report.status = "failed";
  report.failure = {
    phase: report.active,
    kind: error.name,
    message: error.message,
  };
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  for (const role of ["baseline", "candidate"]) {
    if (report.sources[role]) {
      try {
        report.sources[role].healthAfter = health(config[role]);
        if (Object.values(report.sources[role].healthAfter).some(Boolean)) {
          report.status = "failed";
          process.exitCode = 1;
        }
      } catch {
        report.status = "failed";
        process.exitCode = 1;
      }
    }
  }
  report.methodAfter = await verifyFrozenHarness(config.harnessRoot);
  report.driverSha256After = sha(driver);
  if (
    report.methodAfter.harnessFingerprint !== frozen.harnessFingerprint ||
    report.driverSha256After !== report.driverSha256
  ) {
    report.status = "failed";
    process.exitCode = 1;
  }
  report.endedAt = new Date().toISOString();
  write();
}
