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
const sourceEvidence = fs.existsSync("source-evidence.json")
  ? JSON.parse(fs.readFileSync("source-evidence.json"))
  : {};
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
  const activeStreams = new Map();
  const closedPaths = new Set();
  const streams = {
    starts: 0,
    closes: 0,
    startsAfterPriorClose: 0,
    overlappingStarts: 0,
    peakActive: 0,
    activeAtWindowStart: 0,
    activeAtWindowEnd: 0,
    startsDuringWindow: 0,
    closesDuringWindow: 0,
  };
  const closeStream = (request) => {
    const streamPath = activeStreams.get(request);
    if (!streamPath) return;
    activeStreams.delete(request);
    closedPaths.add(streamPath);
    streams.closes++;
    if (measuring) streams.closesDuringWindow++;
  };
  page.on("requestfinished", closeStream);
  page.on("requestfailed", closeStream);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== base.origin) return;
    if (/\/events$/.test(url.pathname) || url.pathname === "/api/live") {
      const streamPath = url.pathname.replace(/\/[0-9a-f-]{36}/gi, "/:fixture");
      streamPaths.add(streamPath);
      if ([...activeStreams.values()].includes(streamPath))
        streams.overlappingStarts++;
      else if (closedPaths.has(streamPath)) streams.startsAfterPriorClose++;
      activeStreams.set(request, streamPath);
      streams.starts++;
      if (measuring) streams.startsDuringWindow++;
      streams.peakActive = Math.max(streams.peakActive, activeStreams.size);
    }
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
  const durationMs = Number(process.env.PERF_IDLE_DURATION_MS ?? 600000);
  if (
    !Number.isInteger(durationMs) ||
    durationMs < 1000 ||
    durationMs > 3600000
  )
    throw new Error("Idle duration must be 1000–3600000 ms");
  streams.activeAtWindowStart = activeStreams.size;
  measuring = true;
  const startedAt = new Date().toISOString();
  await page.waitForTimeout(durationMs);
  measuring = false;
  streams.activeAtWindowEnd = activeStreams.size;
  const report = {
    version: 1,
    ...sourceEvidence,
    provenance: "isolated-seeded-app",
    build: process.env.PERF_BUILD ?? "unknown",
    startedAt,
    durationMs,
    cpuSlowdown: 4,
    screen: "jobs",
    idlePolls: Object.values(reads).reduce((sum, count) => sum + count, 0),
    readRequestsByProcedure: reads,
    observedEventStreamPaths: [...streamPaths],
    eventStreamConnections: streams,
    method:
      "Counts actual GET tRPC request procedures after 15-second startup settling. Tracks /events and /api/live request starts, completion/failure, active and overlapping requests. startsAfterPriorClose is an observed repeat connection, not proof of why it reconnected; an open request does not establish healthy SSE message delivery.",
    limitations:
      "One isolated seeded jobs screen, Clerk stub; not every screen. Connection liveness is HTTP request lifetime, not server heartbeat receipt. Earlier archived 65-second observations retain their original narrower definition.",
  };
  fs.writeFileSync(
    process.env.PERF_IDLE_OUTPUT ?? "perf-idle.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
