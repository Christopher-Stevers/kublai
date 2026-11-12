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
const require = createRequire(import.meta.url),
  esbuild = createRequire(require.resolve("tsx"))("esbuild");
// Parent supervisor owns one worker process group and the exact browser PID
// recorded by that worker. All outputs use an exclusive attempt directory.
if (!process.argv.includes("--worker")) {
  const directory = await fs.mkdtemp(
    path.resolve("perf/artifacts/notification-owner-http-attempt-"),
  );
  const worker = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "--worker"],
    {
      detached: true,
      stdio: "inherit",
      env: { ...process.env, NOTIFICATION_OWNER_OUTPUT: directory },
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
const outputDirectory = process.env.NOTIFICATION_OWNER_OUTPUT;
if (!outputDirectory) throw Error("Owned supervisor output directory required");
const temp = await fs.mkdtemp(
  path.join(os.tmpdir(), "foremanhq-notification-owner-browser-"),
);
const result = {
  method: "notification-overview-owner-component-http-v1",
  limits: [
    "Actual Center/Dialog and owner hook with real QueryClient and local 250ms HTTP replies",
    "Synthetic transport replaces tRPC context; lazy body/router/simulation are presentation fixtures",
    "Not production auth, batching, app latency, full idle or activation evidence",
  ],
  requests: [],
  checks: [],
  externalRequests: [],
  cleanup: {},
};
let browser, browserServer, browserProcess, server;
let boundPort;
const watchdog = setTimeout(() => {
  result.watchdogExpired = true;
  void browser?.close();
  server?.closeAllConnections();
  server?.close();
}, 85_000);
try {
  result.sourceHashes = {};
  for (const name of [
    "scripts/test-notification-owner-browser.mjs",
    "src/lib/app-page-activity.ts",
    "src/hooks/use-online-status.ts",
    "src/hooks/use-notification-account.ts",
    "src/components/notifications/NotificationCenter.tsx",
    "scripts/fixtures/notification-owner/app.jsx",
    "scripts/fixtures/notification-owner/api.jsx",
  ])
    result.sourceHashes[name] = createHash("sha256")
      .update(await fs.readFile(name))
      .digest("hex");
  await esbuild.build({
    entryPoints: ["scripts/fixtures/notification-owner/app.jsx"],
    outfile: path.join(temp, "app.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "synthetic-component-seams",
        setup(build) {
          build.onResolve({ filter: /^~\/trpc\/react$/ }, () => ({
            path: path.resolve("scripts/fixtures/notification-owner/api.jsx"),
          }));
          const virtual = {
            "~/components/simulation/SimulationProvider":
              "export const useEmployeeSimulation=()=>null;",
            "next/navigation":
              'export const useRouter=()=>({push(){throw Error("Navigation excluded")}});',
            "./NotificationPanel":
              'import React from "react";export default function Panel(){return <input aria-label="Inbox local draft" defaultValue="original"/>;}',
            "./use-notification-reminder":
              "export const useNotificationReminder=()=>0;",
          };
          build.onResolve(
            {
              filter:
                /^(~\/components\/simulation\/SimulationProvider|next\/navigation|\.\/NotificationPanel|\.\/use-notification-reminder)$/,
            },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: virtual[args.path],
            loader: "jsx",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    if (pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
      );
    } else if (pathname === "/app.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(await fs.readFile(path.join(temp, "app.js")));
    } else if (
      ["/fixture/identity", "/fixture/overview", "/fixture/list"].includes(
        pathname,
      )
    ) {
      const event = {
        endpoint: pathname,
        startedAt: Date.now(),
        startedMonotonic: performance.now(),
        finishedMonotonic: null,
        finishedAt: null,
      };
      result.requests.push(event);
      setTimeout(() => {
        event.finishedAt = Date.now();
        event.finishedMonotonic = performance.now();
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            pathname.endsWith("identity")
              ? { accountKey: "synthetic:org" }
              : pathname.endsWith("overview")
                ? {
                    accountKey: "synthetic:org",
                    unreadCount: 2,
                    readTargets: [],
                  }
                : { items: [], nextCursor: null },
          ),
        );
      }, 250);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  boundPort = server.address().port;
  const origin = `http://127.0.0.1:${boundPort}`;
  result.origin = origin;
  browserServer = await chromium.launchServer({
    executablePath: "/usr/bin/chromium",
    headless: true,
  });
  browserProcess = browserServer.process();
  const browserStat = await fs.readFile(
    `/proc/${browserProcess.pid}/stat`,
    "utf8",
  );
  await fs.writeFile(
    path.join(outputDirectory, "owned-browser.json"),
    JSON.stringify({
      pid: browserProcess.pid,
      startTime: browserStat
        .slice(browserStat.lastIndexOf(")") + 2)
        .split(" ")[19],
    }),
    { flag: "wx" },
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext();
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    result.externalRequests.push(route.request().method());
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  result.browserErrors = [];
  page.on("pageerror", (error) => result.browserErrors.push(String(error)));
  await page.goto(origin);
  await page.getByRole("button", { name: "Notifications, 2 unread" }).click();
  await page.getByLabel("Inbox local draft").fill("retained browser draft");
  await page.evaluate(() => {
    window.ownedDraft = document.querySelector(
      '[aria-label="Inbox local draft"]',
    );
  });
  const finished = (name) =>
    result.requests.filter(
      (event) =>
        event.endpoint === `/fixture/${name}` && event.finishedAt !== null,
    ).length;
  await expect
    .poll(() => finished("overview"), { timeout: 65000, intervals: [100] })
    .toBe(4);
  const cycles = result.requests.filter(
    (event) => event.endpoint === "/fixture/overview",
  );
  assert.equal(cycles.length, 4);
  const cadenceMs = [
    cycles[2].startedMonotonic - cycles[1].startedMonotonic,
    cycles[3].startedMonotonic - cycles[2].startedMonotonic,
  ];
  const spanMs = cycles[3].startedMonotonic - cycles[1].startedMonotonic;
  assert.ok(
    cadenceMs.every((value) => value >= 29_000),
    "Two distinct 30s cadence intervals required (>=29s scheduling tolerance)",
  );
  assert.ok(spanMs >= 59_000, "Two-cycle span must be >=59s");
  result.cadence = {
    cadenceMs,
    spanMs,
    declaredMinimumCadenceMs: 29_000,
    declaredMinimumSpanMs: 59_000,
  };
  assert.equal(finished("identity"), 1);
  await expect(
    page.getByRole("dialog", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByLabel("Inbox local draft")).toHaveValue(
    "retained browser draft",
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.ownedDraft ===
        document.querySelector('[aria-label="Inbox local draft"]'),
    ),
    true,
  );
  result.checks.push({
    name: "Two real 30-second overview cycles with250ms replies, identity bootstrap only, actual dialog/draft DOM retained",
    pass: true,
    identityReplies: finished("identity"),
    overviewReplies: finished("overview"),
  });
  await context.setOffline(true);
  await expect(
    page.getByRole("dialog", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByLabel("Inbox local draft")).toHaveValue(
    "retained browser draft",
  );
  await context.setOffline(false);
  await expect
    .poll(() => finished("identity"), { timeout: 5000 })
    .toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.notificationFixture.setActive(false));
  await expect(page.getByLabel("Inbox local draft")).toHaveValue(
    "retained browser draft",
  );
  await page.evaluate(() => window.notificationFixture.setActive(true));
  await expect
    .poll(() => finished("identity"), { timeout: 5000 })
    .toBeGreaterThanOrEqual(3);
  assert.equal(
    await page.evaluate(
      () =>
        window.ownedDraft ===
        document.querySelector('[aria-label="Inbox local draft"]'),
    ),
    true,
  );
  result.checks.push({
    name: "Offline/reconnect and cooperative hidden/resume retain dialog and DOM with fresh HTTP identity catchup",
    pass: true,
  });
  assert.equal(result.externalRequests.length, 0);
  assert.equal(result.browserErrors.length, 0);
  assert.equal(result.watchdogExpired, undefined);
  result.status = "PASS";
} catch (error) {
  result.status = "FAIL";
  result.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  try {
    await browser?.close();
    await browserServer?.close();
    result.cleanup.browserClosed = true;
    result.cleanup.browserProcessExited =
      !browserProcess ||
      browserProcess.exitCode !== null ||
      browserProcess.signalCode !== null;
  } catch (error) {
    result.cleanup.browserError = String(error);
    process.exitCode = 1;
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    result.cleanup.serverClosed = true;
    result.cleanup.boundPortClosed = await new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port: boundPort });
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", (error) => resolve(error.code === "ECONNREFUSED"));
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (!result.cleanup.boundPortClosed) {
      result.status = "FAIL";
      process.exitCode = 1;
    }
  }
  await fs.rm(temp, { recursive: true, force: true });
  result.cleanup.tempRemoved = true;
  result.sourceHashesAfter = {};
  for (const name of Object.keys(result.sourceHashes ?? {}))
    result.sourceHashesAfter[name] = createHash("sha256")
      .update(await fs.readFile(name))
      .digest("hex");
  result.sourcesUnchanged =
    JSON.stringify(result.sourceHashes) ===
    JSON.stringify(result.sourceHashesAfter);
  if (!result.sourcesUnchanged) {
    result.status = "FAIL";
    process.exitCode = 1;
  }
  await fs.writeFile(
    path.join(outputDirectory, "report.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(result));
}
