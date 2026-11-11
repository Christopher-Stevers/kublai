// Supplemental instrumentation only. Never supplies or replaces a release gate.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { verifyFrozenHarness } from "./harness-fingerprint.mjs";
import { READ_PREFLIGHT_PROCEDURES, budgets } from "./check.mjs";
const expect = playwrightExpect.configure({ timeout: 60000 });
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const output =
  process.env.PERF_DIAGNOSTIC_OUTPUT ?? "openjob-phase-diagnostic.json";
const driver = fileURLToPath(import.meta.url);
const sha = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const harness = config.harnessRoot;
const frozenBefore = await verifyFrozenHarness(harness);
if (
  frozenBefore.harnessFingerprint !==
  "25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4"
)
  throw Error("Wrong frozen preparation method");
const report = {
  kind: "supplemental-instrumented-diagnostic",
  protocol: "openjob-phase-diagnostic-v1",
  acceptedGateEvidence: false,
  status: "incomplete",
  startedAt: new Date().toISOString(),
  driverSha256Before: sha(driver),
  driverReadOnly: (fs.statSync(driver).mode & 0o222) === 0,
  preparationMethodFingerprint: frozenBefore.harnessFingerprint,
  order:
    "Per link, pairs alternate A→B then B→A; five samples per source/link,20total",
  sources: {},
  samples: [],
  limitations: [
    "Separate instrumented protocol; original frozen gate and failed candidate remain unchanged.",
    "DOM visibility and rAF callbacks are readiness/paint opportunities, not physical first paint or compositor display.",
    "MutationObserver, continuous rAF and PerformanceObserver add browser work; both sources receive identical instrumentation.",
    "Two isolated app servers run concurrently; idle-server overhead is a supplemental diagnostic difference.",
    "No true device/production auth/private SW/background-update/offline target proof.",
    "Shared host production/OS activity remains uncontrolled.",
  ],
};
const write = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
const databaseHealth = (source) => {
  const text = fs.readFileSync(source.databaseLog, "utf8");
  return {
    errors: (text.match(/^.*\bERROR:/gm) ?? []).length,
    fatals: (text.match(/^.*\bFATAL:/gm) ?? []).length,
  };
};
const sources = {};
for (const role of ["baseline", "candidate"]) {
  const source = config[role],
    base = new URL(source.base);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    base.pathname !== "/"
  )
    throw Error("Loopback app root required");
  if (
    !source.databaseLog.startsWith("/tmp/foremanhq-perf-pg.") ||
    !source.databaseLog.endsWith("/server.log")
  )
    throw Error("Private database log required");
  const evidence = JSON.parse(fs.readFileSync(source.sourceEvidence));
  const preflight = JSON.parse(fs.readFileSync(source.preflight));
  if (
    evidence.sourceBuild !== source.expectedSourceBuild ||
    evidence.sourceFingerprint !== source.expectedSourceFingerprint ||
    preflight.status !== "passed" ||
    preflight.sourceBuild !== evidence.sourceBuild ||
    preflight.sourceFingerprint !== evidence.sourceFingerprint ||
    preflight.build !== source.expectedLabBuild ||
    READ_PREFLIGHT_PROCEDURES.some(
      (name) =>
        !preflight.results.some(
          (r) => r.procedure === name && r.status === "ok",
        ),
    )
  )
    throw Error("Exact source/build preflight required");
  const attestation = await fetch(new URL("/api/perf-lab", base)).then((r) =>
    r.json(),
  );
  if (
    attestation.provenance !== "isolated-seeded-app" ||
    attestation.productionDatabase !== false
  )
    throw Error("Synthetic-only app attestation required");
  const fixture = JSON.parse(fs.readFileSync(source.fixtures));
  if (
    fixture.provenance !== "isolated-seeded-app" ||
    fixture.productionDatabase !== false
  )
    throw Error("Synthetic fixture required");
  const health = databaseHealth(source);
  if (health.errors || health.fatals)
    throw Error("Private database must be healthy");
  process.env.PERF_FIXTURES = source.fixtures;
  const adapter = await import(
    pathToFileURL(path.join(harness, "perf/journeys.mjs")).href +
      `?phase-diagnostic=${role}`
  );
  sources[role] = { ...source, base, fixture, adapter };
  report.sources[role] = {
    sourceBuild: evidence.sourceBuild,
    sourceFingerprint: evidence.sourceFingerprint,
    labBuild: preflight.build,
    preflight,
    healthBefore: health,
  };
}
if (!report.driverReadOnly)
  throw Error("Diagnostic driver must be a frozen read-only copy");
write();
let currentContext;
const controller = new AbortController();
const totalTimer = setTimeout(() => controller.abort(), 480000);
const interrupt = () => controller.abort();
process.once("SIGTERM", interrupt);
process.once("SIGINT", interrupt);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
report.browserVersion = browser.version();
const abortPromise = new Promise((_, reject) =>
  controller.signal.addEventListener(
    "abort",
    () => reject(Error("Diagnostic interrupted or total time bound reached")),
    { once: true },
  ),
);
void abortPromise.catch(() => undefined);
try {
  for (const link of ["Basement", "Office"])
    for (let run = 0; run < 5; run++)
      for (const role of run % 2 === 0
        ? ["baseline", "candidate"]
        : ["candidate", "baseline"]) {
        report.active = { role, link, run, phase: "prepare" };
        write();
        const source = sources[role];
        let sampleTimer;
        const sample = async () => {
          const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 3,
            isMobile: true,
            hasTouch: true,
          });
          currentContext = context;
          await context.route("**/*", (route) => {
            const u = new URL(route.request().url());
            return u.origin === source.base.origin ||
              ["data:", "blob:"].includes(u.protocol)
              ? route.continue()
              : route.abort("blockedbyclient");
          });
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
          await cdp.send("Network.enable");
          const profile = budgets.links[link];
          await cdp.send("Network.emulateNetworkConditions", {
            offline: false,
            latency: profile.latencyMs,
            downloadThroughput: profile.bytesPerSecond,
            uploadThroughput: profile.bytesPerSecond,
          });
          await source.adapter.prepare({
            page,
            base: source.base.href,
            journey: "openjob",
          });
          const target = page
            .getByText(source.fixture.jobName, { exact: true })
            .first();
          await target.evaluate((element) => {
            const d = {
              installedAt: performance.now(),
              pointerdown: [],
              click: [],
              domReadyAt: null,
              raf: [],
              longTasks: [],
              firstRafAfterReady: null,
            };
            const ready = () => {
              const e = document.querySelector(
                '[data-job-card="material-lists"]',
              );
              if (!e) return false;
              const s = getComputedStyle(e);
              return (
                e.getClientRects().length > 0 &&
                s.display !== "none" &&
                s.visibility !== "hidden"
              );
            };
            if (ready())
              throw Error("Destination already visible before timed input");
            const onPointer = (e) => {
              if (element === e.target || element.contains(e.target))
                d.pointerdown.push({
                  observedAt: performance.now(),
                  eventTimeStamp: e.timeStamp,
                  pointerType: e.pointerType ?? "unspecified",
                  isTrusted: e.isTrusted,
                });
            };
            const onClick = (e) => {
              if (element === e.target || element.contains(e.target))
                d.click.push({
                  observedAt: performance.now(),
                  eventTimeStamp: e.timeStamp,
                  pointerType: e.pointerType ?? "unspecified",
                  isTrusted: e.isTrusted,
                });
            };
            document.addEventListener("pointerdown", onPointer, true);
            document.addEventListener("click", onClick, true);
            const observeReady = () => {
              if (d.domReadyAt === null && ready())
                d.domReadyAt = performance.now();
            };
            const mutation = new MutationObserver(observeReady);
            mutation.observe(document.documentElement, {
              subtree: true,
              childList: true,
              attributes: true,
            });
            let frame;
            const tick = (t) => {
              observeReady();
              d.raf.push(t);
              if (d.domReadyAt !== null && d.firstRafAfterReady === null)
                d.firstRafAfterReady = t;
              frame = requestAnimationFrame(tick);
            };
            frame = requestAnimationFrame(tick);
            let tasks;
            try {
              tasks = new PerformanceObserver((list) => {
                for (const e of list.getEntries())
                  d.longTasks.push({
                    startTime: e.startTime,
                    duration: e.duration,
                  });
              });
              tasks.observe({ type: "longtask", buffered: false });
              d.longTaskSupported = true;
            } catch {
              d.longTaskSupported = false;
            }
            window.__openjobPhaseDiagnostic = {
              d,
              finish: () => {
                cancelAnimationFrame(frame);
                mutation.disconnect();
                document.removeEventListener("pointerdown", onPointer, true);
                document.removeEventListener("click", onClick, true);
                if (tasks) {
                  for (const e of tasks.takeRecords())
                    d.longTasks.push({
                      startTime: e.startTime,
                      duration: e.duration,
                    });
                  tasks.disconnect();
                }
                return d;
              },
            };
          });
          report.active.phase = "click";
          const start = performance.now();
          await target.click();
          const clicked = performance.now();
          report.active.phase = "assert";
          await expect(
            page.locator('[data-job-card="material-lists"]'),
          ).toBeVisible();
          const asserted = performance.now();
          report.active.phase = "paint-opportunity";
          const paintFrames = await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame((first) =>
                  requestAnimationFrame((second) =>
                    resolve({ first, second, resolvedAt: performance.now() }),
                  ),
                ),
              ),
          );
          const end = performance.now();
          const observed = await page.evaluate(() =>
            window.__openjobPhaseDiagnostic.finish(),
          );
          if (
            !observed.pointerdown.length ||
            !observed.click.length ||
            observed.domReadyAt === null
          )
            throw Error("Missing browser input/readiness observation");
          const pointer = observed.pointerdown[0].observedAt,
            click = observed.click[0].observedAt;
          return {
            role,
            link,
            run,
            driver: {
              totalMs: end - start,
              clickMs: clicked - start,
              assertMs: asserted - clicked,
              twoRafMs: end - asserted,
            },
            browser: {
              ...observed,
              paintFrames,
              pointerdownToClickMs: click - pointer,
              pointerdownToDomReadyMs: observed.domReadyAt - pointer,
              clickToDomReadyMs: observed.domReadyAt - click,
              domReadyToSecondExplicitRafMs:
                paintFrames.second - observed.domReadyAt,
              frameGapsMs: observed.raf
                .slice(1)
                .map((t, i) => t - observed.raf[i]),
            },
          };
        };
        try {
          const row = await Promise.race([
            sample(),
            abortPromise,
            new Promise((_, reject) => {
              sampleTimer = setTimeout(
                () => reject(Error("Sample90second time bound reached")),
                90000,
              );
            }),
          ]);
          report.samples.push(row);
          write();
        } finally {
          clearTimeout(sampleTimer);
          await currentContext?.close();
          currentContext = undefined;
        }
      }
  report.status = "complete";
  delete report.active;
} catch (error) {
  report.status = controller.signal.aborted ? "interrupted" : "failed";
  report.failure = {
    ...report.active,
    kind: error.name,
    message: "Instrumented diagnostic stopped; no timing/gate waiver.",
  };
  process.exitCode = controller.signal.aborted ? 143 : 1;
} finally {
  clearTimeout(totalTimer);
  process.removeListener("SIGTERM", interrupt);
  process.removeListener("SIGINT", interrupt);
  await currentContext?.close().catch(() => undefined);
  await browser.close();
  for (const role of ["baseline", "candidate"]) {
    report.sources[role].healthAfter = databaseHealth(sources[role]);
    const health = report.sources[role].healthAfter;
    if (health.errors || health.fatals) {
      report.status = "failed";
      report.failure = {
        kind: "DatabaseHealth",
        message: "Private database ERROR/FATAL observed",
      };
      process.exitCode = 1;
    }
  }
  report.endedAt = new Date().toISOString();
  report.driverSha256After = sha(driver);
  report.frozenMethodAfter = (
    await verifyFrozenHarness(harness)
  ).harnessFingerprint;
  write();
}
