// Supplemental compiled-app functional proof only. Never an acceptance timer.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { chromium, expect } from "@playwright/test";
import {
  collectObservedWire,
  stripObservationHeaders,
  CONTEXT_HEADER,
  REQUEST_HEADER,
  observationFailureCode,
} from "./proxy-wire-observer.mjs";
import { createPreferenceObservationContext } from "./preference-observation-context.mjs";
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sha = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const methodFiles = [
  "compiled-preferences-functional.mjs",
  "observed-trpc-response.mjs",
  "preference-observation-context.mjs",
  "proxy-wire-observer.mjs",
];
const methodHashes = () =>
  Object.fromEntries(
    methodFiles.map((file) => [file, sha(new URL(file, import.meta.url))]),
  );
const report = {
  protocol: "compiled-preferences-functional-v5",
  status: "incomplete",
  acceptedGateEvidence: false,
  physicalPhoneEvidence: false,
  startedAt: new Date().toISOString(),
  driverSha256: sha(new URL(import.meta.url)),
  protocolDependencyHashesBefore: methodHashes(),
  stage: "attestation",
  assertions: [],
  requests: [],
  httpAuthority: [],
  observationErrors: [],
  wireResponses: [],
  frames: [],
  controlledMutations: [],
  publicExecutiveStates: [],
  limitations: [
    "Synthetic Clerk identity; actual app HTTP/SQL/SSE/UI, not live Clerk session revocation proof.",
    "Functional intervals and fault injection are separate from the frozen timing driver and ten-minute idle.",
    "Suppresses one covered preference interval only; other polls/server work remain.",
  ],
};
async function executiveState(page, checkpoint, expected = "granted") {
  const edit = page.getByRole("button", { name: "Edit executive sorting", exact: true });
  const close = page.getByRole("button", { name: "Close executive settings", exact: true });
  const describe = async (locator) => {
    const count = await locator.count();
    return { count, visible: count === 1 && await locator.isVisible(), enabled: count === 1 && await locator.isEnabled() };
  };
  const snapshot = async () => ({
    checkpoint, expected, at: Date.now() - started,
    edit: await describe(edit), close: await describe(close),
    select: await describe(page.locator("#settings-list-sort")),
    editingTextVisible: await page.getByText("Editing executive sorting", { exact: true }).isVisible(),
  });
  try {
    if (expected === "denied") {
      await expect(edit).toHaveCount(0);
      await expect(close).toHaveCount(0);
    } else {
      await expect(edit.or(close)).toHaveCount(1);
      const editing = await close.count() === 1;
      const button = editing ? close : edit;
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      const editingText = page.getByText("Editing executive sorting", { exact: true });
      if (editing) {
        await expect(editingText).toBeVisible();
        await expect(page.locator("#settings-list-sort")).toBeVisible();
        await expect(page.locator("#settings-list-sort")).toBeEnabled();
      } else {
        await expect(editingText).toHaveCount(0);
        // The public personal-mode button determines whether a personal editor exists.
        const personal = page.getByRole("button", { name: "Use executive sorting", exact: true });
        if (await personal.count()) {
          await expect(page.locator("#settings-list-sort")).toBeVisible();
          await expect(page.locator("#settings-list-sort")).toBeEnabled();
        } else {
          await expect(page.getByRole("button", { name: "Set my own sorting", exact: true })).toBeVisible();
          await expect(page.locator("#settings-list-sort")).toHaveCount(0);
        }
      }
    }
  } finally {
    report.publicExecutiveStates.push(await snapshot());
    write();
  }
}
const started = Date.now(),
  deadline = started + 7 * 60_000;
const output = path.resolve(config.output);
fs.mkdirSync(path.dirname(output), { recursive: true });
const write = () =>
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
const pass = (name) => {
  report.assertions.push({ name, at: Date.now() - started });
  write();
};
const wait = async (predicate, ms, label) => {
  const end = Math.min(deadline, Date.now() + ms);
  while (Date.now() < end) {
    if (
      report.observationErrors.some((error) => error.contextId === "consumer")
    )
      throw Error("Consumer real HTTP observation decoding failed");
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(label);
};
const sleep = async (ms) => {
  const end = Date.now() + ms;
  await wait(() => Date.now() >= end, ms + 2000, "Observation window exceeded");
};
const backend = new URL(config.backend),
  proxyBase = new URL(config.proxy);
let sql, browser, proxy, restoreUser, context;
const streams = new Set();
const observationContexts = new Map();
let denyStreams = false;

const violations = [];
report.guardRejections = violations;
const fixedPosts = new Set([
  "/api/replicache/material-lists/pull",
  "/api/replicache/catalogue/pull",
  "/api/perf",
  "/api/debug/client-console-error",
]);
const mutationProcedures = new Set([
  "appDevices.report",
  "user.setMaterialSortPreferences",
]);
const procedures = (url) => {
  const name = decodeURIComponent(url.pathname).replace(/^\/api\/trpc\//, "");
  return /^\w+\.\w+(,\w+\.\w+)*$/.test(name) ? name.split(",") : [];
};
const expectedReads = [
  "user.getMe",
  "notifications.identity",
  "push.identity",
  "job.getJob",
  "materialList.getMaterialList",
  "materialList.getOrderById",
  "drawings.listSets",
  "drawings.getSet",
  "drawingsWorkspace.get",
  "drawingsWorkspace.changes",
  "chat.getOverview",
  "chat.history",
  "rooms.getJobRoomCount",
  "notifications.overview",
];
let fixture, source, databaseLog;
let expectedAdminFatal = 0;
const health = () => {
  const headers = fs
    .readFileSync(databaseLog, "utf8")
    .split("\n")
    .filter((line) => /\b(?:ERROR|FATAL|PANIC):/.test(line));
  const adminFatal = headers.filter((line) =>
    /FATAL:.*terminating connection due to administrator command/.test(line),
  ).length;
  return { unexpectedErrors: headers.length - adminFatal, adminFatal };
};
write();
try {
  for (const url of [backend, proxyBase])
    if (
      url.protocol !== "http:" ||
      url.pathname !== "/" ||
      !["127.0.0.1", "localhost"].includes(url.hostname)
    )
      throw Error("Explicit loopback roots required");
  if (backend.port === proxyBase.port || !/^\d+$/.test(proxyBase.port))
    throw Error("Distinct explicit proxy port required");
  source = JSON.parse(fs.readFileSync(config.sourceEvidence));
  fixture = JSON.parse(fs.readFileSync(config.fixtures));
  const preflight = JSON.parse(fs.readFileSync(config.preflight));
  if (
    !/^[a-f0-9]{64}$/.test(config.expectedSourceBuild) ||
    !/^[a-f0-9]{64}$/.test(config.expectedSourceFingerprint) ||
    source.sourceBuild !== config.expectedSourceBuild ||
    source.sourceFingerprint !== config.expectedSourceFingerprint ||
    preflight.sourceBuild !== source.sourceBuild ||
    preflight.sourceFingerprint !== source.sourceFingerprint ||
    preflight.status !== "passed" ||
    preflight.results.filter((r) => r.status === "ok").length !== 14 ||
    expectedReads.some(
      (procedure) =>
        !preflight.results.some(
          (r) => r.procedure === procedure && r.status === "ok",
        ),
    ) ||
    fixture.provenance !== "isolated-seeded-app" ||
    fixture.productionDatabase !== false
  )
    throw Error("Source/fixture/preflight mismatch");
  const snapshot = fs.realpathSync(config.snapshot);
  if (
    !snapshot.startsWith("/tmp/foremanhq-speed-app-") ||
    !fs.existsSync(path.join(snapshot, "PERF_LAB_ONLY"))
  )
    throw Error("Marked lab artifact required");
  if (
    fs.readFileSync(path.join(snapshot, ".next/BUILD_ID"), "utf8").trim() !==
    config.expectedLabBuild
  )
    throw Error("Wrong compiled artifact");
  const pid = fs.readFileSync(config.serverPid, "utf8").trim();
  if (
    !/^\d+$/.test(pid) ||
    fs.realpathSync("/proc/" + pid + "/cwd") !== snapshot
  )
    throw Error("Server cwd binding mismatch");
  const env = new Map(
    fs
      .readFileSync("/proc/" + pid + "/environ", "utf8")
      .split("\0")
      .map((value) => {
        const i = value.indexOf("=");
        return [value.slice(0, i), value.slice(i + 1)];
      }),
  );
  const db = new URL(env.get("PERF_LAB_DATABASE_URL") ?? "http://invalid");
  const socket = db.searchParams.get("host");
  if (
    !socket?.startsWith("/tmp/foremanhq-perf-pg.") ||
    db.pathname !== "/foremanhq_perf_lab" ||
    db.searchParams.get("port") !== "55463" ||
    env.get("PERF_LAB_SOCKET") !== socket ||
    env.get("DATABASE_URL") !== env.get("PERF_LAB_DATABASE_URL") ||
    env.get("BIM_WORKER_DISABLED") !== "1" ||
    env.get("FOREMANHQ_BACKGROUND_MODE") !== "separate" ||
    !fs.existsSync(path.join(socket, ".s.PGSQL.55463"))
  )
    throw Error("Private process/database binding mismatch");
  const log = fs.realpathSync(config.serverLog);
  if (
    !log.startsWith("/tmp/foremanhq-") ||
    fs.realpathSync("/proc/" + pid + "/fd/1") !== log ||
    fs.realpathSync("/proc/" + pid + "/fd/2") !== log
  )
    throw Error("Private redirected process log required");
  databaseLog = path.join(socket, "server.log");
  report.databaseHealthBefore = health();
  if (
    report.databaseHealthBefore.unexpectedErrors ||
    report.databaseHealthBefore.adminFatal
  )
    throw Error("Private database not clean before functional run");
  const attest = await fetch(new URL("/api/perf-lab", backend), {
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.json());
  if (
    attest.provenance !== "isolated-seeded-app" ||
    attest.productionDatabase !== false
  )
    throw Error("Private HTTP attestation required");
  report.source = {
    sourceBuild: source.sourceBuild,
    sourceFingerprint: source.sourceFingerprint,
    labBuild: config.expectedLabBuild,
    preflightQueries: 14,
    privateProcessBinding: true,
  };
  sql = postgres({
    host: socket,
    port: 55463,
    database: "foremanhq_perf_lab",
    max: 2,
  });
  const original =
    await sql`select role, "stripeSubscriptionId", "subscriptionStatus", "subscriptionEndsAt" from kublai_user where id=${fixture.userId} and "organizationId"=${fixture.organizationId}::uuid`;
  if (original.length !== 1 || original[0].role !== "admin")
    throw Error("Exact seeded admin required");
  restoreUser = async () => {
    const u = original[0];
    await sql`update kublai_user set role=${u.role}, "stripeSubscriptionId"=${u.stripeSubscriptionId}, "subscriptionStatus"=${u.subscriptionStatus}, "subscriptionEndsAt"=${u.subscriptionEndsAt} where id=${fixture.userId} and "organizationId"=${fixture.organizationId}::uuid`;
  };
  function acceptWire(state, metadata, observation, status) {
    if (!state.active) return;
    report.wireResponses.push({
      contextId: state.contextId,
      procedures: metadata.procs,
      requestAt: metadata.at - started,
      responseAt: Date.now() - started,
      wireBytes: observation.wireBytes,
      decodedBytes: observation.decodedBytes,
      requestTransport: observation.requestTransport,
      responseContentType: observation.responseContentType,
    });
    for (let index = 0; index < metadata.procs.length; index++) {
      const procedure = metadata.procs[index],
        row = observation.rows[index];
      if (
        ![
          "user.getMyRole",
          "user.getMaterialSortPreferences",
          "user.setMaterialSortPreferences",
        ].includes(procedure)
      )
        continue;
      const requestAt = metadata.at,
        responseAt = Date.now(),
        success = status >= 200 && status < 300 && row?.ok === true;
      if (procedure === "user.setMaterialSortPreferences") {
        state.mutationAcks.push({
          requestAt,
          responseAt,
          success,
          data: success ? row.data : null,
        });
        report.httpAuthority.push({
          contextId: state.contextId,
          procedure,
          requestAt: requestAt - started,
          responseAt: responseAt - started,
          success,
        });
        continue;
      }
      if (!success) {
        report.httpAuthority.push({
          contextId: state.contextId,
          procedure,
          requestAt: requestAt - started,
          responseAt: responseAt - started,
          success: false,
          errorCode: row?.errorCode ?? "HTTP_ERROR",
        });
        if (procedure === "user.getMyRole") state.setRole(null);
        else state.setPreference(null);
        continue;
      }
      const data = row.data;
      if (
        !data ||
        typeof data !== "object" ||
        typeof data.canEditExecutive !== "boolean"
      )
        throw Object.assign(Error("Authority schema missing"), {
          observationCode: "AUTHORITY_SCHEMA_MISSING",
        });
      const observed = {
        requestAt,
        responseAt,
        canEditExecutive: data.canEditExecutive,
      };
      if (procedure === "user.getMyRole") {
        Object.assign(observed, {
          accountMatches:
            data.accountScope === `${fixture.organizationId}:${fixture.userId}`,
          appAccess: data.appAccess,
          role: data.role,
        });
        state.setRole(observed);
        report.httpAuthority.push({
          contextId: state.contextId,
          procedure,
          requestAt: requestAt - started,
          responseAt: responseAt - started,
          success: true,
          accountMatches: observed.accountMatches,
          appAccess: observed.appAccess,
          canEditExecutive: observed.canEditExecutive,
          role: ["admin", "foreman", "worker"].includes(observed.role)
            ? observed.role
            : "other",
        });
      } else {
        state.setPreference(observed);
        report.httpAuthority.push({
          contextId: state.contextId,
          procedure,
          requestAt: requestAt - started,
          responseAt: responseAt - started,
          success: true,
          canEditExecutive: observed.canEditExecutive,
        });
      }
    }
  }
  const wireError = (state, error) => {
    if (state?.active) {
      report.observationErrors.push({
        contextId: state.contextId,
        kind: "HTTP_WIRE_OBSERVATION_FAILED",
        reason: observationFailureCode(error),
        at: Date.now() - started,
      });
      write();
    }
  };
  proxy = http.createServer((req, res) => {
    const url = new URL(req.url, proxyBase),
      labels = stripObservationHeaders(req.headers),
      state = observationContexts.get(labels.contextId),
      metadata = state?.pendingRequests.get(labels.requestId);
    const tracked = !!metadata;
    if (url.pathname === "/api/live" && denyStreams) {
      res.writeHead(503, { "cache-control": "no-store" });
      res.end("Functional SSE outage");
      return;
    }
    let downstreamClosed = false,
      collectionDone = false;
    const upstream = http.request(
      new URL(req.url, backend),
      { method: req.method, headers: labels.headers },
      (response) => {
        response.on("error", () => {
          if (!res.destroyed) res.destroy();
        });
        if (tracked) {
          void collectObservedWire(response, {
            requestAccept: labels.headers["trpc-accept"] ?? null,
            count: metadata.procs.length,
          })
            .then((observation) =>
              acceptWire(state, metadata, observation, response.statusCode),
            )
            .catch((error) => wireError(state, error))
            .finally(() => {
              collectionDone = true;
              upstream.setTimeout(0);
              state.pendingRequests.delete(labels.requestId);
              if (downstreamClosed) upstream.destroy();
            });
        }
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    if (tracked)
      upstream.setTimeout(5000, () => {
        if (tracked)
          wireError(
            state,
            Object.assign(Error("Wire timeout"), {
              observationCode: "WIRE_TIMEOUT",
            }),
          );
        upstream.destroy();
      });
    const stream = url.pathname === "/api/live" ? { res, upstream } : null;
    if (stream) streams.add(stream);
    res.on("close", () => {
      downstreamClosed = true;
      if (!tracked || collectionDone) upstream.destroy();
      if (stream) streams.delete(stream);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(Number(proxyBase.port), "127.0.0.1", resolve);
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  async function openPage(contextId) {
    const ctx = await browser.newContext();
    const observedContext = createPreferenceObservationContext(
      contextId,
      report,
    );
    observedContext.pendingRequests = new Map();
    observedContext.mutationAcks = [];
    observationContexts.set(contextId, observedContext);
    let requestSequence = 0;
    ctx.on("close", () => {
      observedContext.active = false;
    });
    await ctx.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (["data:", "blob:"].includes(url.protocol)) return route.continue();
      let safe =
        url.origin === proxyBase.origin &&
        ["GET", "HEAD"].includes(request.method());
      if (url.origin === proxyBase.origin && request.method() === "POST") {
        const procs = procedures(url);
        safe =
          fixedPosts.has(url.pathname) ||
          (procs.length > 0 && procs.every((p) => mutationProcedures.has(p)));
        if (
          /^\/api\/replicache\/(material-lists|catalogue)\/push$/.test(
            url.pathname,
          )
        )
          try {
            const body = request.postDataJSON();
            safe =
              Array.isArray(body?.mutations) && body.mutations.length === 0;
          } catch {
            safe = false;
          }
      }
      if (!safe) {
        violations.push({
          method: request.method(),
          path:
            url.origin === proxyBase.origin &&
            (procedures(url).length || fixedPosts.has(url.pathname))
              ? url.pathname
              : "/unclassified-path",
        });
        report.guardRejections = violations;
        write();
        return route.abort("blockedbyclient");
      }
      const procs = procedures(url),
        at = Date.now();
      for (const procedure of procs)
        observedContext.recordRequest({
          procedure,
          method: request.method(),
          at: at - started,
        });
      if (
        procs.some((procedure) =>
          [
            "user.getMyRole",
            "user.getMaterialSortPreferences",
            "user.setMaterialSortPreferences",
          ].includes(procedure),
        )
      ) {
        const requestId = `${contextId}-${++requestSequence}`;
        observedContext.pendingRequests.set(requestId, {
          procs,
          at,
          method: request.method(),
        });
        return route.continue({
          headers: {
            ...(await request.allHeaders()),
            [CONTEXT_HEADER]: contextId,
            [REQUEST_HEADER]: requestId,
          },
        });
      }
      return route.continue();
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(60000);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    cdp.on("Network.eventSourceMessageReceived", (event) => {
      if (!["preferences-ready", "live"].includes(event.eventName)) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (event.eventName === "preferences-ready") {
        if (
          Object.keys(data).some((k) => k !== "ready") ||
          typeof data.ready !== "boolean"
        )
          violations.push({ reason: "Non-content-free readiness frame" });
        const frame = {
          contextId,
          event: "preferences-ready",
          ready: data.ready,
          at: Date.now() - started,
        };
        observedContext.recordFrame(frame);
      } else if (data.topic === "preferences") {
        if (
          Object.keys(data).some(
            (k) => !["topic", "version", "kind"].includes(k),
          )
        )
          violations.push({ reason: "Non-content-free preference frame" });
        const frame = {
          contextId,
          event: "preferences",
          kind: data.kind,
          at: Date.now() - started,
        };
        observedContext.recordFrame(frame);
      }
    });
    await page.goto(new URL("/jobs/account/settings", proxyBase).href);
    return { ctx, page, observed: observedContext };
  }
  context = await openPage("consumer");
  const { page } = context;
  const consumer = context.observed;
  report.stage = "compiled-readiness";
  write();
  await wait(
    () =>
      consumer.frames.some((f) => f.event === "preferences-ready" && f.ready),
    30000,
    "Compiled LISTEN readiness never became true",
  );
  await wait(
    () =>
      consumer.latestRole?.accountMatches &&
      consumer.latestRole?.appAccess &&
      consumer.latestRole?.canEditExecutive &&
      consumer.latestPreference?.canEditExecutive,
    35000,
    "No actual matching role/preference HTTP authority",
  );
  await executiveState(page, "initial-authority-grant");
  pass("compiled LISTEN ready and real HTTP authority grant public controls");
  await sleep(2000);
  report.stage = "healthy-observation";
  const quiet = Date.now();
  await sleep(75000);
  const reads = consumer.requests.filter(
    (r) =>
      r.at >= quiet - started &&
      r.procedure === "user.getMaterialSortPreferences",
  );
  const roles = consumer.requests.filter(
    (r) => r.at >= quiet - started && r.procedure === "user.getMyRole",
  );
  if (reads.length !== 0 || roles.length < 2)
    throw Error(
      "Healthy preference suppression/shared authority cadence failed",
    );
  if ((await page.evaluate(() => document.visibilityState)) !== "visible")
    throw Error("Hidden page cannot prove suppression");
  pass(
    "75-second healthy preference interval suppressed while existing role HTTP refreshes continue",
  );
  report.stage = "preference-producer";
  await page
    .getByRole("button", { name: "Edit executive sorting", exact: true })
    .click();
  const producer = await openPage("producer");
  await producer.page
    .getByRole("button", { name: "Edit executive sorting", exact: true })
    .click();
  const beforeHint = consumer.frames.length;
  const mutationAt = Date.now();
  await producer.page.locator("#settings-list-sort").selectOption("recent");
  await wait(
    () =>
      producer.observed.mutationAcks.some(
        (ack) =>
          ack.requestAt >= mutationAt &&
          ack.success &&
          ack.data?.shared?.sortMode === "recent",
      ),
    15000,
    "No real producer preference wire ACK",
  );
  await expect(
    producer.page.getByText(
      "Sorting is saved to your account and available for offline lists.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator("#settings-list-sort")).toHaveValue("recent");
  await wait(
    () =>
      consumer.frames
        .slice(beforeHint)
        .some((f) => f.event === "preferences" && f.kind === "settings"),
    10000,
    "No real preference notification",
  );
  await producer.ctx.close();
  await page.bringToFront();
  pass(
    "public producer write reaches other public UI through real content-free hint and HTTP catch-up",
  );
  report.stage = "subscription-expiry";
  const expiresStart = Date.now();
  await sql`update kublai_user set role='foreman', "stripeSubscriptionId"='sub_perf_lab_authority', "subscriptionStatus"='active', "subscriptionEndsAt"=now()+interval '35 seconds' where id=${fixture.userId} and "organizationId"=${fixture.organizationId}::uuid`;
  report.controlledMutations.push({
    kind: "seeded-user-subscription-expiry",
    at: expiresStart - started,
  });
  await wait(
    () =>
      consumer.latestRole?.requestAt >= expiresStart &&
      consumer.latestRole.role === "foreman" &&
      consumer.latestRole.canEditExecutive === true,
    34000,
    "No live role HTTP before controlled expiry",
  );
  await wait(
    () =>
      consumer.latestRole?.requestAt > expiresStart + 35000 &&
      consumer.latestRole.canEditExecutive === false,
    70000,
    "Expiry did not revoke through real role HTTP",
  );
  await executiveState(page, "expired-authority-denial", "denied");
  pass(
    "time expiry revokes executive controls through actual shared role HTTP without preference mutation",
  );
  const restoreAt = Date.now();
  await restoreUser();
  await wait(
    () =>
      consumer.latestRole?.requestAt >= restoreAt &&
      consumer.latestRole.canEditExecutive === true,
    35000,
    "Fresh role HTTP did not restore authority",
  );
  await executiveState(page, "restored-authority-grant");
  pass("fresh real HTTP authority restores controls");
  report.stage = "stream-outage";
  const outage = Date.now();
  denyStreams = true;
  for (const stream of [...streams]) {
    stream.upstream.destroy();
    stream.res.destroy();
  }
  await sleep(75000);
  const fallbackReads = consumer.requests.filter(
    (r) =>
      r.at >= outage - started &&
      r.procedure === "user.getMaterialSortPreferences",
  );
  if (
    fallbackReads.length < 2 ||
    !fallbackReads.some((r) => r.at >= outage - started + 55000)
  )
    throw Error(
      "No immediate catch-up plus fallback preference cadence during sustained outage",
    );
  if (
    !consumer.latestRole?.canEditExecutive ||
    consumer.latestRole.requestAt < outage
  )
    throw Error("No fresh HTTP authority during stream outage");
  await executiveState(page, "stream-outage-authority-grant");
  pass(
    "SSE outage restores preference fallback while fresh HTTP keeps executive editing available",
  );
  const reconnect = Date.now();
  denyStreams = false;
  await wait(
    () =>
      consumer.frames.some(
        (f) =>
          f.at >= reconnect - started &&
          f.event === "preferences-ready" &&
          f.ready,
      ),
    35000,
    "No real SSE readiness after outage",
  );
  pass("transport reconnect reestablishes real topic readiness");
  report.stage = "listen-reconnect";
  const listeners =
    await sql`select pid from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and query ~* '^listen[[:space:]]+"?foremanhq_change'`;
  if (listeners.length !== 1) throw Error("Private LISTEN PID ambiguous");
  const lossAt = Date.now();
  expectedAdminFatal = 1;
  await sql`select pg_terminate_backend(${listeners[0].pid})`;
  report.controlledMutations.push({
    kind: "terminate-exact-private-listen-backend",
    at: lossAt - started,
    expectedAdminFatal: 1,
  });
  await wait(
    () =>
      consumer.frames.some(
        (f) =>
          f.at >= lossAt - started &&
          f.event === "preferences-ready" &&
          !f.ready,
      ),
    10000,
    "No actual LISTEN-loss readiness false",
  );
  await wait(
    () =>
      consumer.frames.some(
        (f) =>
          f.at >= lossAt - started &&
          f.event === "preferences-ready" &&
          f.ready,
      ),
    35000,
    "No actual LISTEN resubscribe readiness true",
  );
  await wait(
    () =>
      consumer.requests.some(
        (r) =>
          r.at >= lossAt - started &&
          r.procedure === "user.getMaterialSortPreferences",
      ),
    10000,
    "No authoritative catch-up after LISTEN restart",
  );
  await wait(
    () => consumer.latestPreference?.requestAt >= lossAt,
    10000,
    "No successful consumer preference HTTP response after LISTEN restart",
  );
  pass(
    "compiled private LISTEN loss/resubscribe emits false/true and successful consumer HTTP catch-up",
  );
  if (violations.length) throw Error("Request/frame guard rejected work");
  report.status = "complete";
} catch (error) {
  report.status = "failed";
  report.failure = {
    stage: report.stage,
    name: error.name,
    message: error.message,
  };
  process.exitCode = 1;
} finally {
  try {
    await restoreUser?.();
  } catch {
    report.restoreFailed = true;
    report.status = "failed";
    process.exitCode = 1;
  }
  await browser?.close().catch(() => {});
  for (const stream of streams) {
    stream.upstream.destroy();
    stream.res.destroy();
  }
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  await sql?.end({ timeout: 1 });
  if (databaseLog) {
    try {
      report.databaseHealthAfter = health();
      if (
        report.databaseHealthAfter.unexpectedErrors ||
        report.databaseHealthAfter.adminFatal !== expectedAdminFatal
      ) {
        report.status = "failed";
        report.databaseHealthMismatch = true;
        process.exitCode = 1;
      }
    } catch {
      report.status = "failed";
      report.databaseHealthUnavailable = true;
      process.exitCode = 1;
    }
  }
  report.protocolDependencyHashesAfter = methodHashes();
  if (
    JSON.stringify(report.protocolDependencyHashesBefore) !==
    JSON.stringify(report.protocolDependencyHashesAfter)
  ) {
    report.status = "failed";
    report.protocolDependenciesChanged = true;
    process.exitCode = 1;
  }
  report.driverSha256After = sha(new URL(import.meta.url));
  if (report.driverSha256After !== report.driverSha256) {
    report.status = "failed";
    process.exitCode = 1;
  }
  report.endedAt = new Date().toISOString();
  write();
}
