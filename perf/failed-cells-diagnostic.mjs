// Supplemental Phase0/R19 five-cell profiling. Never acceptance timing or a gate retry.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import {
  installFailedCellObservation,
  quantityPushIdentity,
  assertNavigationPreconditions,
  assertCaptureBounds,
} from "./failed-cells-observation.mjs";
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = path.resolve(config.outputDirectory);
fs.mkdirSync(out, { recursive: true });
const driver = fileURLToPath(import.meta.url);
const sha = (p) =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const { verifyFrozenHarness } = await import(
  pathToFileURL(path.join(config.harnessRoot, "perf/harness-fingerprint.mjs"))
    .href
);
const frozen = await verifyFrozenHarness(config.harnessRoot);
if (
  frozen.harnessFingerprint !==
  "25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4"
)
  throw Error("Wrong frozen method");
const { READ_PREFLIGHT_PROCEDURES, budgets } = await import(
  pathToFileURL(path.join(config.harnessRoot, "perf/check.mjs")).href
);
const expected = {
  baseline: [
    "c25f525d3a4755145e22b9977b300607209034ff59196ee170cbe219cf2c2e5d",
    "128da6e7cd4b35dce132d543a56ed673f8dce30fae56f7456b1fc3d94f5e8dd2",
  ],
  candidate: [
    "47b6e70541a3f513f852e93aef05aa4f389544f72f4626082f447f53d0956ece",
    "4541b37e0ff7144287d9187384eeb9ae7ebe1c9aa88e31fcaa53cee03a8b05c7",
  ],
};
const report = {
  protocol: "failed-cells-cpu-diagnostic-v1",
  guardRejections: [],
  attemptId: config.attemptId ?? "attempt1",
  acceptedGateEvidence: false,
  status: "incomplete",
  startedAt: new Date().toISOString(),
  driverSha256: sha(driver),
  observationSha256: sha(
    new URL("./failed-cells-observation.mjs", import.meta.url),
  ),
  methodFingerprint: frozen.harnessFingerprint,
  profile: {
    cells: [
      "openjob/Site",
      "openjob/Office",
      "openmateriallist/Basement",
      "openmateriallist/Site",
      "changeqty/Site",
    ],
    cpuSlowdown: 4,
    preparedAsFrozenAdapter: true,
    samplingIntervalUs: 1000,
    maxCaptureMs: 3000,
    maxTraceBytes: 20 * 1024 ** 2,
    maxCpuBytes: 5 * 1024 ** 2,
    maxTotalBytes: 250 * 1024 ** 2,
  },
  sources: {},
  samples: [],
  observations: {},
  limitations: [
    "One profiled original operation/source/cell; no significance or acceptance timing claim.",
    "Sampling and timeline instrumentation perturb execution.",
    "DOM readiness and two rAF are paint opportunities, not hardware presentation.",
    "Minified sample names may not identify React components or render/commit phases.",
    "Passive work after the original action two-rAF boundary is omitted; instrumentation perturbs the action; no continuous geometry sampling is installed.",
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
      fixture.productionDatabase !== false ||
      attestation.authentication !== "stubbed-seeded-user" ||
      attestation.userId !== fixture.userId
    )
      throw Error("Synthetic fixture required");
    if (
      fs
        .readFileSync(path.join(s.snapshot, ".next/BUILD_ID"), "utf8")
        .trim() !== s.expectedLabBuild
    )
      throw Error("Retained compiled build mismatch");
    const serverPid = fs.readFileSync(s.serverPid, "utf8").trim();
    if (
      !/^\d+$/.test(serverPid) ||
      fs.realpathSync(`/proc/${serverPid}/cwd`) !== s.snapshot
    )
      throw Error("Server cwd mismatch");
    if (
      fs.realpathSync(`/proc/${serverPid}/fd/1`) !==
        fs.realpathSync(s.serverLog) ||
      fs.realpathSync(`/proc/${serverPid}/fd/2`) !==
        fs.realpathSync(s.serverLog)
    )
      throw Error("Server output binding mismatch");
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
      env.get("BIM_WORKER_DISABLED") !== "1" ||
      env.get("FOREMANHQ_BACKGROUND_MODE") !== "separate" ||
      env.get("PORT") !== base.port
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
        `?quantity-cpu=${role}`
    );
    s.base = base;
    s.fixture = fixture;
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  report.browserVersion = browser.version();
  const cells = [
    ["openjob", "Site"],
    ["openjob", "Office"],
    ["openmateriallist", "Basement"],
    ["openmateriallist", "Site"],
    ["changeqty", "Site"],
  ];
  let operation = 0;
  for (const [cellIndex, [journey, link]] of cells.entries())
    for (const role of cellIndex % 2 === 0
      ? ["baseline", "candidate"]
      : ["candidate", "baseline"]) {
      const s = config[role],
        sampleId = `${++operation}-${role}-${journey}-${link}`;
      report.active = { role, journey, link, sampleId, phase: "prepare" };
      write();
      context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      });
      const denied = [];
      let permittedQuantityWrite = null;
      let quantityEnvelope = null;
      const requests = {};
      await context.route("**/*", async (route) => {
        const r = route.request(),
          u = new URL(r.url()),
          method = r.method();
        let emptyPush = false,
          quantityPush = false;
        if (
          method === "POST" &&
          /^\/api\/replicache\/[^/]+\/push$/.test(u.pathname)
        ) {
          try {
            const body = r.postDataJSON();
            emptyPush =
              Array.isArray(body?.mutations) && body.mutations.length === 0;
            const identity =
              u.pathname === "/api/replicache/material-lists/push"
                ? quantityPushIdentity(
                    body,
                    permittedQuantityWrite === null
                      ? null
                      : {
                          itemId: s.expectedQuantityItemId,
                          materialListId: s.fixture.materialListId,
                          quantity: permittedQuantityWrite,
                        },
                    quantityEnvelope,
                  )
                : null;
            quantityPush = identity !== null;
            if (quantityPush) quantityEnvelope = identity;
          } catch {
            /* Reject unparseable/nonempty pushes. */
          }
        }
        const safe =
          u.origin === s.base.origin &&
          (["GET", "HEAD"].includes(method) ||
            (method === "POST" &&
              [
                "/api/replicache/material-lists/pull",
                "/api/replicache/catalogue/pull",
                "/api/perf",
                "/api/trpc/appDevices.report",
                "/api/debug/client-console-error",
              ].includes(u.pathname)) ||
            emptyPush ||
            quantityPush);
        if (!safe && !["data:", "blob:"].includes(u.protocol)) {
          // Persist before abort, including failures before a sample exists. Only
          // fixed endpoint shapes/procedure names are retained; never URL query,
          // request bodies, cookies, arbitrary path segments or external origins.
          const sameOrigin = u.origin === s.base.origin;
          const procedurePath =
            /^\/api\/trpc\/[A-Za-z][A-Za-z0-9_]{0,63}\.[A-Za-z][A-Za-z0-9_]{0,63}(,[A-Za-z][A-Za-z0-9_]{0,63}\.[A-Za-z][A-Za-z0-9_]{0,63})*$/.test(
              u.pathname,
            );
          const replicachePath =
            /^\/api\/replicache\/(material-lists|catalogue)\/(pull|push)$/.test(
              u.pathname,
            );
          const telemetryPath =
            u.pathname === "/api/perf" ||
            u.pathname === "/api/debug/client-console-error";
          const rejection = {
            method: [
              "GET",
              "HEAD",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
              "OPTIONS",
            ].includes(method)
              ? method
              : "OTHER",
            path:
              sameOrigin && (procedurePath || replicachePath || telemetryPath)
                ? u.pathname.slice(0, 180)
                : "/unclassified-path",
            reason: sameOrigin
              ? "method-or-post-path-rejected"
              : "origin-rejected",
          };
          denied.push(rejection);
          report.guardRejections.push(rejection);
          write();
          return route.abort("blockedbyclient");
        }
        const key = `${method} ${u.pathname.startsWith("/api/trpc/") ? u.pathname : "/non-rpc"}`;
        requests[key] = (requests[key] ?? 0) + 1;
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      page.setDefaultNavigationTimeout(60000);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await cdp.send("Network.enable");
      const p = budgets.links[link];
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
          journey,
        }),
        60000,
        "Preparation timeout",
      );
      if (denied.length)
        throw Error("Quantity request guard rejected preparation");
      let input,
        target,
        inputElement = null,
        targetElement;
      let sourcePreconditions, destinationPathname;
      if (journey === "changeqty") {
        const proofBytes = fs.readFileSync(s.quantityItemProof);
        const proof = JSON.parse(proofBytes);
        if (
          proof.version !== 1 ||
          proof.provenance !== "isolated-seeded-app" ||
          proof.productionDatabase !== false ||
          proof.sourceBuild !== expected[role][0] ||
          proof.sourceFingerprint !== expected[role][1] ||
          proof.labBuild !== s.expectedLabBuild ||
          proof.materialListId !== s.fixture.materialListId ||
          proof.organizationId !== s.fixture.organizationId ||
          proof.totalItems !== 25 ||
          proof.privateDatabase?.socket !== path.dirname(s.databaseLog) ||
          proof.privateDatabase?.port !== 55463 ||
          proof.privateDatabase?.database !== "foremanhq_perf_lab" ||
          proof.privateDatabase?.readOnly !== true ||
          proof.sourceEvidenceSha256 !== sha(s.sourceEvidence) ||
          proof.fixturesSha256 !== sha(s.fixtures) ||
          !Array.isArray(proof.eligibleItems) ||
          proof.eligibleItems.length !== 24 ||
          new Set(proof.eligibleItems.map((row) => row.itemId)).size !== 24 ||
          new Set(proof.eligibleItems.map((row) => row.partName)).size !== 24 ||
          proof.eligibleItems.some(
            (row) =>
              !/^[0-9a-f-]{36}$/i.test(row.itemId) ||
              row.materialListId !== s.fixture.materialListId ||
              row.sentOrderItemId !== null ||
              typeof row.partName !== "string" ||
              !row.partName.startsWith("Synthetic ") ||
              !Number.isFinite(Number(row.quantity)),
          )
        )
          throw Error("Synthetic readonly quantity item proof mismatch");
        input = page
          .getByRole("textbox", { name: "Quantity", exact: true })
          .first();
        target = page
          .getByRole("button", { name: "Increase quantity", exact: true })
          .first();
        await expect(target).toBeVisible();
        const inputHandle = await input.elementHandle(),
          buttonHandle = await target.elementHandle();
        const binding = await page.evaluate(
          ({ input, button }) => {
            const card = button?.closest('[data-slot="card"]');
            if (
              !input ||
              !button ||
              !card ||
              input.closest('[data-slot="card"]') !== card ||
              card.querySelectorAll("h3").length !== 1 ||
              card.querySelectorAll('input[aria-label="Quantity"]').length !==
                1 ||
              card.querySelectorAll('button[aria-label="Increase quantity"]')
                .length !== 1
            )
              throw Error(
                "Selected quantity controls do not identify a unique part card",
              );
            return {
              partName: card.querySelector("h3").textContent.trim(),
              quantity: Number(input.value),
              sameSelectedCard: true,
              uniqueHeadingAndControls: true,
            };
          },
          { input: inputHandle, button: buttonHandle },
        );
        const matches = proof.eligibleItems.filter(
          (row) =>
            row.partName === binding.partName &&
            Number(row.quantity) === binding.quantity,
        );
        if (matches.length !== 1)
          throw Error(
            "Selected UI card not unique in synthetic readonly proof",
          );
        s.expectedQuantityItemId = matches[0].itemId;
        destinationPathname = `/jobs/material-lists/${encodeURIComponent(s.fixture.materialListId)}`;
        if (new URL(page.url()).pathname !== destinationPathname)
          throw Error("Wrong source pathname");
        sourcePreconditions = {
          sameOriginalFirstExactControl: true,
          originalPreparation: "changeqty",
          defaultLocatorClick: true,
          noForce: true,
          initialQuantity: binding.quantity,
          quantityProofSha256: sha(s.quantityItemProof),
          selectedItemId: s.expectedQuantityItemId,
          selectedCard: binding,
          syntheticReadonlyProofVerified: true,
        };
        write();
        permittedQuantityWrite = binding.quantity + 1;
        inputElement = inputHandle;
        targetElement = buttonHandle;
      } else {
        target = page
          .getByText(
            journey === "openjob"
              ? s.fixture.jobName
              : s.fixture.materialListName,
            { exact: true },
          )
          .first();
        await expect(target).toBeVisible();
        await expect(target).toBeEnabled();
        const destination =
          journey === "openjob"
            ? page.locator('[data-job-card="material-lists"]')
            : page
                .getByRole("button", { name: "Increase quantity", exact: true })
                .first();
        await expect(destination).not.toBeVisible();
        const expectedSource =
          journey === "openjob"
            ? "/jobs"
            : `/jobs/${encodeURIComponent(s.fixture.jobId)}/material-lists`;
        assertNavigationPreconditions({
          targetVisible: await target.isVisible(),
          targetEnabled: await target.isEnabled(),
          destinationVisible: await destination.isVisible(),
          pathname: new URL(page.url()).pathname,
          expectedPathname: expectedSource,
        });
        destinationPathname =
          journey === "openjob"
            ? "/jobs"
            : `/jobs/material-lists/${encodeURIComponent(s.fixture.materialListId)}`;
        targetElement = await target.elementHandle();
        sourcePreconditions = {
          originalFirstExactText: true,
          destinationHidden: true,
          pathname: expectedSource,
          defaultClick: true,
        };
      }
      report.active.sourcePreconditions = sourcePreconditions;
      write();
      await page.evaluate(installFailedCellObservation, {
        target: targetElement,
        input: inputElement,
      });
      page.setDefaultTimeout(3000);
      page.setDefaultNavigationTimeout(3000);
      const requestBefore = { ...requests };
      const instrumentationStarted = performance.now();
      const deadline = instrumentationStarted + 3000;
      let captureStage = "profiler-enable";
      const withinCapture = (start, label) => {
        captureStage = label;
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw Error(`Capture deadline: ${label}`);
        return bounded(
          Promise.resolve().then(start),
          remaining,
          `Capture deadline: ${label}`,
        );
      };
      let completed;
      const done = new Promise((resolve) => {
        completed = resolve;
      });
      cdp.once("Tracing.tracingComplete", completed);
      let cpu, traceStream, observed, browserActionStart, adapterDurationMs;
      let started;
      report.active.phase = "capture";
      write();
      try {
        await withinCapture(
          () => cdp.send("Profiler.enable"),
          "profiler-enable",
        );
        await withinCapture(
          () => cdp.send("Profiler.setSamplingInterval", { interval: 1000 }),
          "profiler-interval",
        );
        await withinCapture(
          () =>
            cdp.send("Tracing.start", {
              categories:
                "devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline.stack",
              transferMode: "ReturnAsStream",
              options: "record-as-much-as-possible",
            }),
          "trace-start",
        );
        await withinCapture(() => cdp.send("Profiler.start"), "profiler-start");
        started = performance.now();
        browserActionStart = await withinCapture(
          () =>
            page.evaluate(() => {
              const at = performance.now();
              performance.mark("failed-cells-diagnostic:action-start", {
                startTime: at,
              });
              return { at, timeOrigin: performance.timeOrigin };
            }),
          "browser-action-anchor",
        );
        await withinCapture(async () => {
          // Invoke the unmodified frozen operation: old-value read, default
          // locator.click, notToHaveValue and original two-rAF. Never force.
          const adapterStart = performance.now();
          await s.adapter[journey]({ page });
          adapterDurationMs = performance.now() - adapterStart;
          if (new URL(page.url()).pathname !== destinationPathname)
            throw Error("Wrong destination pathname");
        }, "original-action");
        observed = await withinCapture(
          () => page.evaluate(() => window.__failedCellsDiagnostic.finish()),
          "observation-finish",
        );
        report.observations[sampleId] = {
          browserActionStart,
          adapterDurationMs,
          observed,
        };
        cpu = (
          await withinCapture(() => cdp.send("Profiler.stop"), "profiler-stop")
        ).profile;
        await withinCapture(() => cdp.send("Tracing.end"), "trace-stop");
        traceStream = (await withinCapture(() => done, "trace-completion"))
          .stream;
      } catch (error) {
        report.captureFailure = {
          role,
          sampleId,
          journey,
          link,
          stage: captureStage,
          elapsedMs: performance.now() - instrumentationStarted,
          sharedDeadlineMs: 3000,
          emergencyCloseOutsideCapture: true,
        };
        write();
        // CDP timeout cannot prove Chrome has stopped. Destroy this owned context
        // instead of allowing another capture; external supervisor is final bound.
        await bounded(
          context.close(),
          3000,
          "Emergency owned context close timeout",
        ).catch(() => {});
        context = undefined;
        throw error;
      }
      const captureMs = performance.now() - started;
      const instrumentationSetupAndCaptureMs =
        performance.now() - instrumentationStarted;
      if (instrumentationSetupAndCaptureMs > 3000)
        throw Error("Capture exceeded shared3s deadline");
      const cpuText = JSON.stringify(cpu);
      if (Buffer.byteLength(cpuText) > report.profile.maxCpuBytes)
        throw Error("CPU profile size bound");
      fs.writeFileSync(path.join(out, `${sampleId}.cpuprofile`), cpuText);
      let total = 0;
      const traceFile = path.join(out, `${sampleId}.trace.json`),
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
        await bounded(
          cdp.send("IO.close", { handle: traceStream }),
          3000,
          "Trace close timeout",
        );
      }
      const row = {
        role,
        journey,
        link,
        sampleId,
        sourcePreconditions,
        variant: journey === "changeqty" ? "operation" : "visited-navigation",
        captureMs,
        instrumentationSetupAndCaptureMs,
        browserActionStart,
        observed,
        requestsBeforeCapture: requestBefore,
        requestsAfterCapture: requests,
        denied,
        files: {
          cpu: `${sampleId}.cpuprofile`,
          trace: `${sampleId}.trace.json`,
        },
        bytes: { cpu: Buffer.byteLength(cpuText), trace: total },
        profileNodes: cpu.nodes.length,
        samples: cpu.samples?.length ?? 0,
      };
      assertCaptureBounds(
        instrumentationSetupAndCaptureMs,
        row.bytes.cpu,
        row.bytes.trace,
        report.samples.reduce(
          (sum, item) => sum + item.bytes.cpu + item.bytes.trace,
          0,
        ),
      );
      report.samples.push(row);
      write();
      if (captureMs > 3000 || instrumentationSetupAndCaptureMs > 3000)
        throw Error("Capture exceeded3s including setup/stop");
      if (
        denied.length ||
        !observed.events.some((event) => event.type === "pointerdown") ||
        !observed.events.some((event) => event.type === "pointerup") ||
        !observed.events.some((event) => event.type === "click") ||
        (journey === "changeqty" &&
          !observed.commits.some(
            (commit) =>
              commit.afterTrustedInput &&
              commit.after === permittedQuantityWrite,
          ))
      )
        throw Error("Observation/write guard failed");
      await context.close();
      context = undefined;
    }
  const bytes = report.samples.reduce(
    (sum, row) => sum + row.bytes.cpu + row.bytes.trace,
    0,
  );
  if (bytes > report.profile.maxTotalBytes)
    throw Error("Total artifact size bound");
  if (report.samples.length !== 10) throw Error("All ten operations required");
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
    report.driverSha256After !== report.driverSha256 ||
    sha(new URL("./failed-cells-observation.mjs", import.meta.url)) !==
      report.observationSha256
  ) {
    report.status = "failed";
    process.exitCode = 1;
  }
  report.endedAt = new Date().toISOString();
  write();
}
