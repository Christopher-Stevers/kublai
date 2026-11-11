// Browser driver for the disposable seeded application, never a remote URL.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { verifyFrozenHarness } from "./harness-fingerprint.mjs";
import { chromium } from "@playwright/test";
import { budgets, validateReport } from "./check.mjs";
const base = new URL(process.env.PERF_BASE_URL ?? "http://127.0.0.1:3481");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
  throw new Error("Performance write journeys require loopback isolated lab");
if (!process.env.PERF_JOURNEY_ADAPTER)
  throw new Error(
    "PERF_JOURNEY_ADAPTER must name the seeded-app journey module; no live-data fallback",
  );
const harnessRoot =
  process.env.PERF_HARNESS_DIR ??
  path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const harnessBefore = await verifyFrozenHarness(harnessRoot);
if (
  fs.realpathSync(process.env.PERF_JOURNEY_ADAPTER) !==
  fs.realpathSync(path.join(harnessRoot, "perf/journeys.mjs"))
)
  throw new Error("Journey adapter must be the frozen attested method");
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
try {
  const harnessToolchain = {
    node: process.version,
    playwright: createRequire(import.meta.url)("@playwright/test/package.json")
      .version,
    browser: browser.version(),
  };
  const methodBinding = {
    harnessFingerprint: harnessBefore.harnessFingerprint,
    harnessFingerprintAlgorithm: harnessBefore.harnessFingerprintAlgorithm,
    harnessFileCount: harnessBefore.harnessFileCount,
    harnessToolchain,
    harnessVerification: {
      before: harnessBefore.harnessFingerprint,
      after: null,
      immutable: true,
    },
  };
  const sourceEvidence = fs.existsSync("source-evidence.json")
    ? JSON.parse(fs.readFileSync("source-evidence.json"))
    : {};
  const labStatic = fs.existsSync("lab-static-bytes.json")
    ? JSON.parse(fs.readFileSync("lab-static-bytes.json"))
    : undefined;
  const samples = [];
  const timestamp = new Date().toISOString();
  const protocol = {
    id: process.env.PERF_SHEET_PROTOCOL ?? "early-pinch-v1",
    sheetCost:
      "Outer wallclock includes sheet-open click, any readiness wait, verified pinch and final PDF coverage. Browser stage marks are dispatch-to-sampled-ready measures, not same-frame proof.",
    coveragePollMs: 50,
  };
  const staticMetrics = await adapter.staticMetrics?.();
  const preflight = JSON.parse(fs.readFileSync("preflight.json"));
  if (
    preflight.status !== "passed" ||
    preflight.build !== process.env.PERF_BUILD ||
    preflight.sourceFingerprint !== sourceEvidence.sourceFingerprint
  )
    throw new Error("Source-bound endpoint preflight must pass before timing");
  const pgDirectory = process.env.PERF_LAB_SOCKET;
  if (!pgDirectory?.startsWith("/tmp/foremanhq-perf-pg."))
    throw new Error("Private database observation path required");
  const inventory = JSON.parse(
    fs.readFileSync(path.join(pgDirectory, "schema-inventory.json")),
  );
  const databaseCounts = () => {
    const text = fs.readFileSync(path.join(pgDirectory, "server.log"), "utf8");
    return {
      count: (text.match(/^\d{4}-\d{2}-\d{2}.*?\bERROR:/gm) ?? []).length,
      fatalCount: (text.match(/^\d{4}-\d{2}-\d{2}.*?\bFATAL:/gm) ?? []).length,
    };
  };
  const beforeDatabase = databaseCounts();
  if (beforeDatabase.count || beforeDatabase.fatalCount)
    throw new Error(
      "Fixture startup/preflight already produced database errors; capture cannot begin",
    );
  const health = () => {
    const current = databaseCounts();
    return {
      preflight,
      fixtureSchema: {
        status: "source-declared-schemas-created",
        sourceBuild: sourceEvidence.sourceBuild,
        sourceFingerprint: sourceEvidence.sourceFingerprint,
        moduleCount: inventory.moduleCount,
        tableCount: inventory.tables.length,
        coverage: inventory.limitations,
      },
      database: {
        count: current.count - beforeDatabase.count,
        fatalCount: current.fatalCount - beforeDatabase.fatalCount,
        windowStartedAt: timestamp,
        observedAt: new Date().toISOString(),
        source: "private PostgreSQL ERROR/FATAL headers; no SQL or parameters",
      },
    };
  };

  const save = (status) =>
    fs.writeFileSync(
      process.env.PERF_OUTPUT ?? "perf-report.json",
      JSON.stringify(
        {
          version: 1,
          ...sourceEvidence,
          ...methodBinding,
          provenance: "isolated-seeded-app",
          cpuSlowdown: 4,
          build: process.env.PERF_BUILD ?? "unknown",
          timestamp,
          status,
          protocol,
          device: {
            kind: "desktop-chromium-mobile-emulation",
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 3,
            physicalPixelMeasured: false,
          },
          samples,
          health: health(),
          static: staticMetrics,
          labStatic,
        },
        null,
        2,
      ),
    );
  for (const [link, profile] of Object.entries(budgets.links).filter(
    ([name]) =>
      process.env.PERF_LINKS
        ? process.env.PERF_LINKS.split(",").includes(name)
        : !process.env.PERF_PILOT || name === "Office",
  ))
    for (const journey of budgets.journeys.filter(
      (name) =>
        !process.env.PERF_JOURNEYS ||
        process.env.PERF_JOURNEYS.split(",").includes(name),
    ))
      for (
        let run = 0;
        run < Number(process.env.PERF_RUNS ?? (process.env.PERF_PILOT ? 1 : 5));
        run++
      ) {
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
        const encodings = new Set();
        if (process.env.PERF_DIAGNOSTICS === "1")
          page.on("response", async (response) => {
            const url = new URL(response.url());
            if (
              url.origin !== base.origin ||
              !url.pathname.startsWith("/_next/static/")
            )
              return;
            const encoding = await response
              .headerValue("content-encoding")
              .catch(() => null);
            encodings.add(encoding ?? "identity");
          });
        let rejectApi;
        const apiFailure = new Promise((_, reject) => {
          rejectApi = reject;
        });
        void apiFailure.catch(() => undefined);
        page.on("response", async (response) => {
          const url = new URL(response.url());
          if (
            url.origin !== base.origin ||
            !url.pathname.startsWith("/api/trpc/")
          )
            return;
          const procedure = decodeURIComponent(
            url.pathname.slice("/api/trpc/".length),
          );
          if (!/^[A-Za-z0-9_,.]+$/.test(procedure)) return;
          try {
            const text = await response.text();
            const code = text.match(
              /"code"\s*:\s*"(INTERNAL_SERVER_ERROR|BAD_REQUEST|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|TIMEOUT)"/,
            )?.[1];
            if (response.status() >= 400 || code)
              rejectApi(
                new Error(
                  `Application tRPC error ${procedure}: ${code ?? response.status()}; SQL/parameters omitted`,
                ),
              );
          } catch {
            /* Cancelled navigations can close a response body. */
          }
        });
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
          await Promise.race([
            adapter.prepare?.({ page, base: base.href, journey, run }),
            apiFailure,
          ]);
          const browserStart =
            journey === "coldstart"
              ? null
              : await page.evaluate(() => performance.now());
          const start = performance.now();
          // Journey must resolve only after its observable painted/sharp state; no fixed-delay completion.
          await Promise.race([
            adapter[journey]({ page, base: base.href, run, cdp }),
            apiFailure,
          ]);
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
                      "lab:sheet-open-to-ready",
                      "lab:cached-pinch-to-sharp",
                      "lab:gesture-duration",
                      "lab:gesture-end-to-sharp",
                    ].includes(entry.name) &&
                    (since === null || entry.startTime >= since),
                )
                .map((entry) => ({
                  name: entry.name.replace(/^(foremenhq|lab):/, ""),
                  durationMs: entry.duration,
                })),
            browserStart,
          );
          const diagnostics =
            process.env.PERF_DIAGNOSTICS === "1"
              ? await page.evaluate(
                  (since) => ({
                    drawing: performance
                      .getEntriesByName("foremanhq:drawing-detail")
                      .map((entry) => {
                        const value = entry.detail ?? {};
                        return {
                          startMs: entry.startTime,
                          loadMs: value.loadMs,
                          renderMs: value.renderMs,
                          viewToSharpMs: value.viewToSharpMs,
                          pixels: value.pixels,
                          outcome: value.outcome,
                        };
                      }),
                    resources: performance
                      .getEntriesByType("resource")
                      .filter(
                        (entry) => since === null || entry.startTime >= since,
                      )
                      .map((entry) => {
                        const path = new URL(entry.name).pathname;
                        return {
                          kind: path.includes(".pdf")
                            ? "pdf"
                            : path.includes(".webp")
                              ? "image"
                              : path.includes("worker")
                                ? "worker"
                                : path.includes("/api/trpc/")
                                  ? "rpc"
                                  : path.includes(".js")
                                    ? "script"
                                    : "other",
                          startMs: entry.startTime,
                          durationMs: entry.duration,
                          encodedBytes: entry.encodedBodySize,
                          transferBytes: entry.transferSize,
                        };
                      }),
                    browserScale: visualViewport?.scale ?? 1,
                  }),
                  browserStart,
                )
              : undefined;
          if (diagnostics) diagnostics.staticResponseEncodings = [...encodings];
          samples.push({
            browserMeasures,
            diagnostics,
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
          const databaseHealth = health().database;
          if (databaseHealth.count || databaseHealth.fatalCount)
            throw new Error(
              "Private database reported ERROR/FATAL during capture; timing evidence invalid",
            );
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
  const harnessAfter = await verifyFrozenHarness(harnessRoot);
  methodBinding.harnessVerification.after = harnessAfter.harnessFingerprint;
  const report = {
    version: 1,
    ...sourceEvidence,
    ...methodBinding,
    provenance: "isolated-seeded-app",
    cpuSlowdown: 4,
    build: process.env.PERF_BUILD ?? "unknown",
    timestamp,
    status: "complete",
    protocol,
    device: {
      kind: "desktop-chromium-mobile-emulation",
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      physicalPixelMeasured: false,
    },
    samples,
    health: health(),
    static: staticMetrics,
    labStatic,
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
