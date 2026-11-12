// Supplemental source-identical timing-boundary diagnostic. Never acceptance evidence.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { installOfficeObservation } from "./material-office-timeline-observation.mjs";
import {
  decodeTraceFiles,
  requestPath,
  allowReadRequest,
} from "./material-office-timeline-records.mjs";
const config = JSON.parse(fs.readFileSync(process.argv[2]));
const out = config.outputDirectory;
if (out !== "/tmp/foremanhq-office-timeline-attempt1/captures")
  throw Error("Owned output required");
fs.mkdirSync(out, { recursive: true });
const report = {
  protocol: "active-office-material-timeline-v1",
  status: "preparing",
  acceptanceEvidence: false,
  nodeTimeOrigin: performance.timeOrigin,
  sourceBuild:
    "9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0",
  sourceFingerprint:
    "34f0c1508584e40382ad25955b3aa2b5703bdd78ced4e6ef2536e902fd82281d",
  samples: [],
  guardRejections: [],
  active: null,
  limitations: [
    "Instrumented supplemental operations, not comparable acceptance durations",
    "No CPU profiler/CDP tracing, force clicks, DOM readiness observer, geometry patch or continuous RAF",
    "API tracing/observers add work; EventTiming may arrive after drainage or omit below16ms",
    "Absolute clocks retained separately; no outer-minus-browser correction",
    "HTTP overlaps do not establish Replicache/render cause",
  ],
};
const write = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
const sha = (f) =>
  createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const bounded = (fn, ms, label) => {
  let timer;
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise(
      (_, reject) => (timer = setTimeout(() => reject(Error(label)), ms)),
    ),
  ]).finally(() => clearTimeout(timer));
};
let browser,
  context,
  totalBytes = 0;
write();
try {
  const s = config.runtime,
    base = new URL(s.base);
  if (
    base.href !== "http://127.0.0.1:3485/" ||
    s.snapshot !== "/tmp/foremanhq-speed-app-fxHxrn" ||
    s.expectedLabBuild !== "wTBAqKGVn-GRqajiTebMf"
  )
    throw Error("Exact retained runtime required");
  const harness = "/tmp/foremanhq-perf-method-f9bHR6";
  if (config.harnessRoot !== harness) throw Error("Wrong frozen harness");
  const { verifyFrozenHarness } = await import(
    pathToFileURL(harness + "/perf/harness-fingerprint.mjs")
  );
  const verify = async () => {
    const r = await verifyFrozenHarness(harness);
    if (
      r.harnessFingerprint !==
      "25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4"
    )
      throw Error("Frozen method changed");
    return r;
  };
  report.methodBefore = await verify();
  const evidence = JSON.parse(fs.readFileSync(s.sourceEvidence)),
    preflight = JSON.parse(fs.readFileSync(s.preflight)),
    fixture = JSON.parse(fs.readFileSync(s.fixtures));
  const { READ_PREFLIGHT_PROCEDURES, budgets } = await import(
    pathToFileURL(harness + "/perf/check.mjs")
  );
  if (
    evidence.sourceBuild !== report.sourceBuild ||
    evidence.sourceFingerprint !== report.sourceFingerprint ||
    evidence.sourceFileCount !== 2200 ||
    evidence.sourceVerification.unchangedFilesChecked !== 2195 ||
    preflight.status !== "passed" ||
    preflight.build !== s.expectedLabBuild ||
    preflight.sourceBuild !== evidence.sourceBuild ||
    preflight.sourceFingerprint !== evidence.sourceFingerprint ||
    READ_PREFLIGHT_PROCEDURES.some(
      (p) =>
        !preflight.results.some((r) => r.procedure === p && r.status === "ok"),
    )
  )
    throw Error("Source/read preflight binding failed");
  const pid = fs.readFileSync(s.serverPid, "utf8").trim();
  if (
    !/^\d+$/.test(pid) ||
    fs.realpathSync("/proc/" + pid + "/cwd") !== s.snapshot ||
    fs.readFileSync(s.snapshot + "/.next/BUILD_ID", "utf8").trim() !==
      s.expectedLabBuild
  )
    throw Error("PID/cwd/build mismatch");
  for (const fd of [1, 2])
    if (
      fs.realpathSync(`/proc/${pid}/fd/${fd}`) !== fs.realpathSync(s.serverLog)
    )
      throw Error("Server log mismatch");
  const env = new Map(
    fs
      .readFileSync("/proc/" + pid + "/environ", "utf8")
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
    !fs.existsSync(socket + "/.s.PGSQL.55463") ||
    db.pathname !== "/foremanhq_perf_lab" ||
    db.searchParams.get("host") !== socket ||
    db.searchParams.get("port") !== "55463" ||
    env.get("DATABASE_URL") !== env.get("PERF_LAB_DATABASE_URL") ||
    env.get("PORT") !== "3485" ||
    env.get("FOREMANHQ_BACKGROUND_MODE") !== "separate" ||
    env.get("BIM_WORKER_DISABLED") !== "1"
  )
    throw Error("Private PG/env binding failed");
  const health = () =>
    fs
      .readFileSync(s.databaseLog, "utf8")
      .split("\n")
      .filter((x) => /\b(ERROR|FATAL):/.test(x)).length;
  if (health()) throw Error("Preexisting PG errors");
  const attest = await fetch(new URL("/api/perf-lab", base), {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  }).then((r) => {
    if (!r.ok) throw Error("Attestation HTTP");
    return r.json();
  });
  if (
    attest.provenance !== "isolated-seeded-app" ||
    attest.productionDatabase !== false ||
    attest.authentication !== "stubbed-seeded-user" ||
    attest.userId !== fixture.userId ||
    fixture.provenance !== "isolated-seeded-app" ||
    fixture.productionDatabase !== false
  )
    throw Error("Synthetic identity required");
  report.bindings = {
    evidence,
    preflight,
    fixtureSha256: sha(s.fixtures),
    serverPid: Number(pid),
    privateBindingVerified: true,
    healthBefore: health(),
  };
  process.env.PERF_FIXTURES = s.fixtures;
  const adapter = await import(
    pathToFileURL(harness + "/perf/journeys.mjs").href + "?office-timeline-v1"
  );
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const save = (name, data) => {
    const bytes = JSON.stringify(data);
    totalBytes += Buffer.byteLength(bytes);
    if (totalBytes > 60 * 1024 ** 2) throw Error("60MiB artifact cap");
    fs.writeFileSync(path.join(out, name), bytes + "\n");
  };
  for (let block = 1; block <= 2; block++)
    for (let run = 1; run <= 5; run++) {
      const id = `block${block}-run${run}`;
      report.active = { id, block, run, phase: "prepare" };
      write();
      context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      });
      const requests = [],
        denied = [];
      let capture = false;
      await context.route("**/*", (route) => {
        const r = route.request();
        if (!allowReadRequest(r, base.href)) {
          const row = {
            method: r.method(),
            path: requestPath(r.url(), base.href),
          };
          denied.push(row);
          report.guardRejections.push(row);
          write();
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      page.setDefaultNavigationTimeout(60000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.name));
      const http = [],
        pendingResponses = new Set();
      page.on("response", (response) => {
        const u = new URL(response.url());
        if (u.origin !== base.origin || !u.pathname.startsWith("/api/trpc/"))
          return;
        const row = {
          path: requestPath(response.url(), base.href),
          status: response.status(),
          nodeAt: performance.now(),
          phase: capture ? "capture" : "prepare",
          bodyInspection: "pending",
        };
        if (http.length >= 200) {
          errors.push("HTTP-record-cap");
          return;
        }
        http.push(row);
        const task = bounded(
          () => response.text(),
          2000,
          "body-inspection-timeout",
        )
          .then(
            (text) => {
              if (Buffer.byteLength(text) > 1024 ** 2) {
                row.bodyInspection = "oversize";
                errors.push("HTTP-body-inspection-cap");
                return;
              }
              row.errorCode =
                text.match(
                  /"code"\s*:\s*"(INTERNAL_SERVER_ERROR|BAD_REQUEST|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|TIMEOUT)"/,
                )?.[1] ?? null;
              row.bodyInspection = "complete";
              if (row.status >= 400 || row.errorCode)
                errors.push("HTTP-application-error");
            },
            () => {
              row.bodyInspection = "unavailable-or-cancelled";
              if (row.status >= 400) errors.push("HTTP-status-error");
            },
          )
          .finally(() => pendingResponses.delete(task));
        pendingResponses.add(task);
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await cdp.send("Network.enable");
      const p = budgets.links.Office;
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: p.latencyMs,
        downloadThroughput: p.bytesPerSecond,
        uploadThroughput: p.bytesPerSecond,
      });
      await bounded(
        () =>
          adapter.prepare({
            page,
            base: base.href,
            journey: "openmateriallist",
            run: run - 1,
          }),
        60000,
        "Preparation deadline",
      );
      if (denied.length || errors.length)
        throw Error("Preparation guard/browser failure");
      const sourcePath = `/jobs/${fixture.jobId}/material-lists`,
        destPath = `/jobs/material-lists/${fixture.materialListId}`;
      if (new URL(page.url()).pathname !== sourcePath)
        throw Error("Source route mismatch");
      await expect(
        page.getByRole("button", { name: "Increase quantity", exact: true }),
      ).toHaveCount(0);
      const target = page
        .getByText(fixture.materialListName, { exact: true })
        .first();
      await expect(target).toBeVisible();
      await expect(target).toBeEnabled();
      await page.evaluate(
        installOfficeObservation,
        await target.elementHandle(),
      );

      const requestRows = new Map();
      page.on("request", (r) => {
        if (capture && requests.length < 200) {
          const row = {
            path: requestPath(r.url(), base.href),
            method: r.method(),
            nodeAt: performance.now(),
          };
          requestRows.set(r, row);
          requests.push(row);
        }
      });
      page.on("requestfinished", (r) => {
        if (requestRows.has(r))
          requestRows.get(r).finishedNodeAt = performance.now();
      });
      page.on("requestfailed", (r) => {
        if (requestRows.has(r))
          requestRows.get(r).failedNodeAt = performance.now();
      });
      await context.tracing.start({
        screenshots: false,
        snapshots: false,
        sources: false,
      });
      const deadline = performance.now() + 3000;
      const within = (fn, label) =>
        bounded(fn, Math.max(1, deadline - performance.now()), label);
      let observed,
        anchor,
        anchorNodeBefore,
        anchorNodeAfter,
        finishNodeBefore,
        finishNodeAfter,
        tracingStopped = false,
        adapterMs,
        adapterNodeStart,
        adapterNodeEnd,
        apiTraceBytes,
        zipPath = path.join(out, id + ".ephemeral.zip");
      try {
        report.active.phase = "capture";
        write();
        capture = true;
        anchorNodeBefore = performance.now();
        anchor = await within(
          () =>
            page.evaluate(() => {
              const at = performance.now();
              performance.mark("office-timeline:action-start");
              return { at, timeOrigin: performance.timeOrigin };
            }),
          "action-anchor",
        );
        anchorNodeAfter = performance.now();
        const start = performance.now();
        adapterNodeStart = start;
        await within(
          () => adapter.openmateriallist({ page }),
          "frozen-adapter",
        );
        adapterNodeEnd = performance.now();
        adapterMs = adapterNodeEnd - start;
        finishNodeBefore = performance.now();
        observed = await within(
          () => page.evaluate(() => window.__officeTimeline.finish()),
          "finish-observation",
        );
        finishNodeAfter = performance.now();
        observed.currentActionMeasures = observed.measures.filter(
          (m) => m.startTime >= anchor.at,
        );
        observed.preparationMeasures = observed.measures.filter(
          (m) => m.startTime < anchor.at,
        );
        capture = false;
        await within(
          () => Promise.all([...pendingResponses]),
          "http-error-inspection",
        );
        if (
          observed.events.filter((e) => e.type === "pointerdown").length !==
            1 ||
          observed.events.filter((e) => e.type === "click").length !== 1 ||
          observed.currentActionMeasures.length !== 1
        )
          throw Error("Missing or ambiguous current trusted input/app measure");
        if (
          new URL(page.url()).pathname !== destPath ||
          denied.length ||
          errors.length
        )
          throw Error("Operation postcondition failed");
        await within(
          () => context.tracing.stop({ path: zipPath }),
          "api-trace-stop",
        );
        tracingStopped = true;
        const network = execFileSync(
          "unzip",
          ["-p", zipPath, "trace.network"],
          { maxBuffer: 1024, timeout: 1000 },
        );
        if (network.length) throw Error("Unexpected HAR/network capture");
        const text = execFileSync("unzip", ["-p", zipPath, "trace.trace"], {
          maxBuffer: 8 * 1024 ** 2,
          timeout: 1000,
        }).toString();
        apiTraceBytes = Buffer.byteLength(text);
        const api = decodeTraceFiles(text, network);
        save(id + "-api.json", api);
        save(id + "-browser.json", {
          anchor,
          anchorNodeBefore,
          anchorNodeAfter,
          finishNodeBefore,
          finishNodeAfter,
          observed,
          requests,
          http,
        });
        fs.unlinkSync(zipPath);
        if (performance.now() > deadline) throw Error("Capture exceeded3s");
        report.samples.push({
          id,
          block,
          run,
          adapterMs,
          adapterNodeStart,
          adapterNodeEnd,
          anchor,
          anchorNodeBefore,
          anchorNodeAfter,
          finishNodeBefore,
          finishNodeAfter,
          observed,
          http,
          apiTraceBytes,
          apiTraceNetworkBytes: network.length,
          requestCount: requests.length,
          captureElapsedMs: 3000 - (deadline - performance.now()),
          acceptanceEvidence: false,
        });
        write();
      } catch (error) {
        capture = false;
        report.captureFailure = {
          id,
          block,
          run,
          journey: "openmateriallist",
          link: "Office",
          phase: report.active.phase,
          error: error.message,
          anchor,
          anchorNodeBefore,
          anchorNodeAfter,
          finishNodeBefore,
          finishNodeAfter,
          observed,
          requests,
          http,
          adapterMs,
          adapterNodeStart,
          adapterNodeEnd,
        };
        // Retain successful API phases when failure occurs later. Never retain raw ZIP.
        try {
          if (!tracingStopped)
            await bounded(
              () => context.tracing.stop({ path: zipPath }),
              1000,
              "failure-api-trace-stop",
            );
          if (fs.existsSync(zipPath)) {
            const network = execFileSync(
              "unzip",
              ["-p", zipPath, "trace.network"],
              { maxBuffer: 1024, timeout: 1000 },
            );
            const text = execFileSync("unzip", ["-p", zipPath, "trace.trace"], {
              maxBuffer: 8 * 1024 ** 2,
              timeout: 1000,
            }).toString();
            save(id + "-partial-api.json", decodeTraceFiles(text, network));
            report.captureFailure.partialApiPreserved = true;
          }
        } catch {
          report.captureFailure.partialApiPreserved = false;
        }
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        write();
        throw error;
      }
      await bounded(() => context.close(), 3000, "owned-context-close");
      context = null;
      if (health()) throw Error("PG error during diagnostic");
    }
  report.methodAfter = await verify();
  report.healthAfter = health();
  report.status = "complete";
  report.active = null;
  write();
} catch (error) {
  report.status = "failed";
  report.failure = { name: error.name, message: error.message };
  write();
  process.exitCode = 1;
} finally {
  if (context)
    await bounded(() => context.close(), 3000, "emergency-context-close").catch(
      () => {
        process.exitCode = 1;
      },
    );
  if (browser)
    await bounded(() => browser.close(), 3000, "owned-browser-close").catch(
      () => {
        process.exitCode = 1;
      },
    );
  write();
}
