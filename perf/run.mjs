// Browser driver for the disposable seeded application, never a remote URL.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { budgets, validateReport } from "./check.mjs";
const base = new URL(process.env.PERF_BASE_URL ?? "http://127.0.0.1:3481");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
  throw new Error("Performance write journeys require loopback isolated lab");
if (!process.env.PERF_JOURNEY_ADAPTER)
  throw new Error(
    "PERF_JOURNEY_ADAPTER must name the seeded-app journey module; no live-data fallback",
  );
const adapter = await import(
  pathToFileURL(path.resolve(process.env.PERF_JOURNEY_ADAPTER))
);
const attestation = await fetch(new URL("/api/perf-lab", base)).then((r) =>
  r.json(),
);
if (
  attestation.provenance !== "isolated-seeded-app" ||
  attestation.productionDatabase !== false
)
  throw new Error("Disposable seeded database attestation missing");
for (const name of budgets.journeys)
  if (typeof adapter[name] !== "function")
    throw new Error(`Missing scripted journey ${name}`);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const sourceEvidence = fs.existsSync("source-evidence.json")
  ? JSON.parse(fs.readFileSync("source-evidence.json"))
  : {};
const samples = [];
const timestamp = new Date().toISOString();
const staticMetrics = await adapter.staticMetrics?.();
const save = (status) =>
  fs.writeFileSync(
    process.env.PERF_OUTPUT ?? "perf-report.json",
    JSON.stringify(
      {
        version: 1,
        provenance: "isolated-seeded-app",
        cpuSlowdown: 4,
        build: process.env.PERF_BUILD ?? "unknown",
        timestamp,
        status,
        device: {
          kind: "desktop-chromium-mobile-emulation",
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 3,
          physicalPixelMeasured: false,
        },
        samples,
        static: staticMetrics,
      },
      null,
      2,
    ),
  );
try {
  for (const [link, profile] of Object.entries(budgets.links).filter(
    ([name]) => !process.env.PERF_PILOT || name === "Office",
  ))
    for (const journey of budgets.journeys)
      for (let run = 0; run < (process.env.PERF_PILOT ? 1 : 5); run++) {
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
        });
        // A hard boundary: browser traffic cannot escape to production, Clerk or any other host.
        await context.route("**/*", (route) => {
          const u = new URL(route.request().url());
          return u.origin === base.origin ||
            ["data:", "blob:"].includes(u.protocol)
            ? route.continue()
            : route.abort("blockedbyclient");
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: profile.latencyMs,
          downloadThroughput: profile.bytesPerSecond,
          uploadThroughput: profile.bytesPerSecond,
        });
        try {
          await adapter.prepare?.({ page, base: base.href, journey, run });
          const browserStart =
            journey === "coldstart"
              ? null
              : await page.evaluate(() => performance.now());
          const start = performance.now();
          // Journey must resolve only after its observable painted/sharp state; no fixed-delay completion.
          await adapter[journey]({ page, base: base.href, run, cdp });
          const durationMs = performance.now() - start;
          if (pageErrors.length)
            throw new Error(`Browser script error: ${pageErrors.join("; ")}`);
          const browserMeasures = await page.evaluate(
            (since) =>
              performance
                .getEntriesByType("measure")
                .filter(
                  (entry) =>
                    [
                      "foremenhq:tap-to-paint",
                      "foremenhq:write-to-paint",
                      "foremenhq:app-start-to-last-screen",
                      "foremenhq:sheet-open-to-sharp",
                    ].includes(entry.name) &&
                    (since === null || entry.startTime >= since),
                )
                .map((entry) => ({
                  name: entry.name.replace("foremenhq:", ""),
                  durationMs: entry.duration,
                })),
            browserStart,
          );
          samples.push({
            browserMeasures,
            journey,
            link,
            run,
            durationMs,
            variant: ["openjob", "switchjobtabs", "openmateriallist"].includes(
              journey,
            )
              ? "visited"
              : "operation",
          });
          save("incomplete");
          console.log(
            `${journey}/${link}/${run + 1}: ${durationMs.toFixed(1)}ms`,
          );
        } catch (error) {
          await page
            .screenshot({
              path: `${process.env.PERF_OUTPUT ?? "perf-report.json"}.failure.png`,
              fullPage: true,
            })
            .catch(() => undefined);
          throw error;
        } finally {
          await context.close();
        }
      }
  const report = {
    version: 1,
    ...sourceEvidence,
    provenance: "isolated-seeded-app",
    cpuSlowdown: 4,
    build: process.env.PERF_BUILD ?? "unknown",
    timestamp,
    status: "complete",
    device: {
      kind: "desktop-chromium-mobile-emulation",
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      physicalPixelMeasured: false,
    },
    samples,
    static: staticMetrics,
  };
  const errors = validateReport(report);
  if (errors.length && !process.env.PERF_PILOT)
    throw new Error(errors.join("\n"));
  fs.writeFileSync(
    process.env.PERF_OUTPUT ?? "perf-report.json",
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
