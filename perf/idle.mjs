import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const base = new URL(process.env.PERF_BASE_URL ?? "http://127.0.0.1:3481");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
  throw new Error("Idle measurement requires isolated loopback application");
const attestation = await fetch(new URL("/api/perf-lab", base)).then(
  (response) => response.json(),
);
if (
  attestation.provenance !== "isolated-seeded-app" ||
  attestation.productionDatabase !== false
)
  throw new Error("Isolated lab attestation required");
const fixture = JSON.parse(
  fs.readFileSync(
    process.env.PERF_FIXTURES ?? new URL("./fixtures.json", import.meta.url),
  ),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === base.origin
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let measuring = false;
  const reads = {};
  const streamPaths = new Set();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== base.origin) return;
    if (/\/events$/.test(url.pathname))
      streamPaths.add(url.pathname.replace(/\/[0-9a-f-]{36}/gi, "/:fixture"));
    if (
      !measuring ||
      request.method() !== "GET" ||
      !url.pathname.startsWith("/api/trpc/")
    )
      return;
    for (const procedure of decodeURIComponent(
      url.pathname.slice("/api/trpc/".length),
    ).split(",")) {
      if (!/^[A-Za-z0-9_.]+$/.test(procedure)) continue;
      reads[procedure] = (reads[procedure] ?? 0) + 1;
    }
  });
  await page.goto(new URL("/jobs", base).href);
  await expect(
    page.getByText(fixture.jobName, { exact: true }).first(),
  ).toBeVisible({ timeout: 60000 });
  // Settle first-load prefetch/bootstrap traffic before the measured idle window.
  await page.waitForTimeout(15000);
  measuring = true;
  const startedAt = new Date().toISOString();
  await page.waitForTimeout(65000);
  measuring = false;
  const report = {
    version: 1,
    provenance: "isolated-seeded-app",
    build: process.env.PERF_BUILD ?? "unknown",
    startedAt,
    durationMs: 65000,
    cpuSlowdown: 4,
    screen: "jobs",
    idlePolls: Object.values(reads).reduce((sum, count) => sum + count, 0),
    readRequestsByProcedure: reads,
    observedEventStreamPaths: [...streamPaths],
    method:
      "Counts actual GET tRPC request procedures during 65 idle seconds after 15-second startup settling; includes every observed background read, not a source-code polling count. Event paths observed during load/window do not prove those streams remained connected.",
    limitations:
      "One isolated seeded jobs screen, Clerk stub; not every screen, not a complete no-poll or single-stream proof.",
  };
  fs.writeFileSync(
    process.env.PERF_IDLE_OUTPUT ?? "perf-idle.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
