// Manual, bounded protocol diagnosis only. No ADB, browser launch or discovery.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createCdpConnection, CdpTransportError } from "./cdp-transport.mjs";

const DATA_HTML =
  "<!doctype html><meta charset=utf-8><title>Synthetic protocol probe</title><p id=phone-protocol-probe>Synthetic protocol probe</p>";
const DATA_URL = `data:text/html,${encodeURIComponent(DATA_HTML)}`;
const EVENTS = [
  "Page.frameStartedNavigating",
  "Page.frameStartedLoading",
  "Page.frameStoppedLoading",
  "Page.frameNavigated",
  "Page.frameDetached",
  "Page.domContentEventFired",
  "Page.loadEventFired",
  "Page.interstitialShown",
  "Page.interstitialHidden",
  "Page.javascriptDialogOpening",
  "Runtime.executionContextCreated",
  "Runtime.executionContextDestroyed",
  "Runtime.executionContextsCleared",
  "Inspector.detached",
  "Inspector.targetCrashed",
  "Inspector.targetReloadedAfterCrash",
];
function check(value, kind) {
  if (!value) throw new CdpTransportError(kind);
}
function origin(value) {
  const url = new URL(value);
  check(
    url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/",
    "invalid-origin",
  );
  return url;
}
function attested(value) {
  return (
    value?.provenance === "isolated-seeded-app" &&
    value.productionDatabase === false &&
    value.authentication === "stubbed-seeded-user" &&
    value.userId === "perf-lab-user"
  );
}

export async function diagnose(env = process.env) {
  const started = performance.now();
  // Work stops at 50 s, leaving 8 s for exact-ID cleanup and 2 s for the report.
  // CLI also has a 60 s process watchdog. No retries or deadline extensions.
  const workDeadline = started + 50_000;
  const report = {
    method: "phone-owned-target-protocol-diagnostic-v1",
    status: "failed",
    accepted: false,
    physicalPhoneEvidence: false,
    completedSamples: [],
    timestamp: new Date().toISOString(),
    hardLimitMs: 60_000,
    phase: "configuration",
    commands: [],
    events: {},
    sockets: [],
    checks: {},
  };
  let targetId, browserConnection, pageConnection, debug;
  const remaining = () => {
    const ms = Math.floor(workDeadline - performance.now());
    check(ms > 0, "work-deadline");
    return Math.min(5_000, ms);
  };
  const fetchWork = async (url) =>
    fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(remaining()),
    });
  const readJson = async (file) =>
    JSON.parse(
      await fs.readFile(file, {
        encoding: "utf8",
        signal: AbortSignal.timeout(remaining()),
      }),
    );
  const observations = (scope) => (event) => {
    if (event.kind === "event") {
      report.events[event.name] = Math.min(
        10_000,
        (report.events[event.name] ?? 0) + 1,
      );
    } else if (report.sockets.length < 16) {
      report.sockets.push({
        scope,
        ...event,
        elapsedMs: Math.round(performance.now() - started),
      });
    }
  };
  const connect = async (url, scope) => {
    const openTimeoutMs = remaining();
    const connection = createCdpConnection(new WebSocket(url), {
      openTimeoutMs,
      timeoutMs: 5_000,
      eventNames: scope === "page" ? EVENTS : [],
      observe: observations(scope),
    });
    // Assign before waiting so setup failures still close their own socket.
    if (scope === "browser") browserConnection = connection;
    else pageConnection = connection;
    await connection.ready;
    return connection;
  };
  const command = async (connection, method, params = {}, limitMs = 5_000) => {
    const entry = { phase: report.phase, method, status: "pending" };
    report.commands.push(entry);
    try {
      const result = await connection.send(
        method,
        params,
        Math.min(limitMs, remaining()),
      );
      entry.status = "replied";
      return result;
    } catch (error) {
      entry.status = "failed";
      entry.errorKind =
        error instanceof CdpTransportError ? error.kind : "transport-error";
      if (Number.isInteger(error.code)) entry.errorCode = error.code;
      throw error;
    }
  };
  const evaluate = async (expression, limitMs) => {
    const result = await command(
      pageConnection,
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      limitMs,
    );
    check(!result?.exceptionDetails, "evaluation-exception");
    return result?.result?.value;
  };
  const waitBooleans = async (expression, keys) => {
    const deadline = Math.min(workDeadline, performance.now() + 5_000);
    while (true) {
      const limitMs = Math.floor(deadline - performance.now());
      check(limitMs > 0, "document-readiness-timeout");
      const result = await evaluate(expression, limitMs);
      check(
        result && keys.every((key) => typeof result[key] === "boolean"),
        "invalid-readiness-result",
      );
      if (keys.every((key) => result[key]))
        return Object.fromEntries(keys.map((key) => [key, result[key]]));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    check(
      env.PERF_PHONE_DIAGNOSTIC === "owned-target-only",
      "manual-opt-in-required",
    );
    check(
      ["adb-wifi", "adb-usb"].includes(env.PERF_PHONE_CONTROL_TRANSPORT),
      "invalid-transport",
    );
    check(
      !env.PERF_PHONE_BROWSER_LIFETIME ||
        env.PERF_PHONE_BROWSER_LIFETIME === "close-after-create",
      "unsupported-browser-lifetime",
    );
    report.browserLifetime = "close-after-create";
    report.controlTransport = env.PERF_PHONE_CONTROL_TRANSPORT;
    const base = origin(env.PERF_PHONE_BASE);
    const host = origin(env.PERF_PHONE_HOST_BASE);
    debug = origin(env.PERF_PHONE_CDP);
    check(
      host.origin !== debug.origin && base.origin !== debug.origin,
      "overlapping-control-origin",
    );
    report.phase = "source-preflight";
    const root = await fs.realpath(env.PERF_PHONE_LAB_ROOT);
    const pg = await fs.realpath(env.PERF_LAB_SOCKET);
    check(
      pg.startsWith("/tmp/foremanhq-perf-pg."),
      "private-database-required",
    );
    const source = await readJson(path.join(root, "source-evidence.json"));
    const preflight = await readJson(path.join(root, "preflight.json"));
    const fixture = await readJson(path.join(root, "perf/fixtures.json"));
    const inventory = await readJson(path.join(pg, "schema-inventory.json"));
    check(
      /^[a-f0-9]{64}$/.test(source.sourceFingerprint) &&
        source.sourceBuild &&
        preflight.status === "passed" &&
        preflight.sourceFingerprint === source.sourceFingerprint &&
        preflight.sourceBuild === source.sourceBuild &&
        preflight.build === env.PERF_BUILD &&
        inventory.tables?.length &&
        fixture.userId === "perf-lab-user" &&
        fixture.provenance === "isolated-seeded-app" &&
        fixture.productionDatabase === false,
      "synthetic-preflight-required",
    );
    const log = await fs.readFile(path.join(pg, "server.log"), {
      encoding: "utf8",
      signal: AbortSignal.timeout(remaining()),
    });
    check(
      !/^\d{4}-\d{2}-\d{2}.*?\b(?:ERROR|FATAL):/m.test(log),
      "database-health-failed",
    );
    report.sourceBuild = source.sourceBuild;
    report.sourceFingerprint = source.sourceFingerprint;
    report.phase = "host-attestation";
    const response = await fetchWork(new URL("/api/perf-lab", host));
    check(
      response.ok && attested(await response.json()),
      "host-attestation-failed",
    );
    report.phase = "browser-metadata";
    const metadataResponse = await fetchWork(new URL("/json/version", debug));
    check(metadataResponse.ok, "metadata-unavailable");
    const metadata = await metadataResponse.json();
    const advertised = new URL(metadata.webSocketDebuggerUrl);
    check(
      advertised.protocol === "ws:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(advertised.hostname) &&
        /^\/devtools\/browser(?:\/[a-z0-9-]+)?$/i.test(advertised.pathname) &&
        !advertised.search &&
        !advertised.hash &&
        !advertised.username &&
        !advertised.password,
      "invalid-browser-endpoint",
    );
    const controlUrl = new URL(advertised.pathname, debug);
    controlUrl.protocol = "ws:";
    report.phase = "create-owned-target";
    await connect(controlUrl, "browser");
    const created = await command(browserConnection, "Target.createTarget", {
      url: "about:blank",
      forTab: false,
    });
    check(
      typeof created?.targetId === "string" &&
        /^[a-z0-9-]+$/i.test(created.targetId),
      "invalid-created-id",
    );
    targetId = created.targetId;
    report.createdTargetKnown = true;
    browserConnection.close(); // Same lifetime as run.mjs; no retained-mode fallback.
    const pageUrl = new URL(`/devtools/page/${targetId}`, debug);
    pageUrl.protocol = "ws:";
    report.phase = "owned-page-open";
    await connect(pageUrl, "page");
    await command(pageConnection, "Page.enable");
    await command(pageConnection, "Runtime.enable");
    await command(pageConnection, "Page.bringToFront");
    report.phase = "blank-runtime";
    const blank = await evaluate(
      `({blank:location.href==='about:blank',complete:document.readyState==='complete',visible:document.visibilityState==='visible'})`,
    );
    check(
      blank &&
        ["blank", "complete", "visible"].every(
          (key) => typeof blank[key] === "boolean",
        ),
      "invalid-blank-result",
    );
    report.checks.blank = {
      blank: blank.blank,
      complete: blank.complete,
      visible: blank.visible,
    };
    check(blank.blank && blank.complete, "blank-not-ready");
    report.phase = "network-free-navigation";
    const dataNavigation = await command(pageConnection, "Page.navigate", {
      url: DATA_URL,
    });
    check(
      !dataNavigation?.errorText && !dataNavigation?.isDownload,
      "network-free-navigation-rejected",
    );
    report.checks.networkFree = await waitBooleans(
      `({expected:location.href===${JSON.stringify(DATA_URL)},probe:!!document.getElementById('phone-protocol-probe')})`,
      ["expected", "probe"],
    );
    report.phase = "loopback-navigation";
    const labUrl = new URL("/api/perf-lab", base);
    const labNavigation = await command(pageConnection, "Page.navigate", {
      url: labUrl.href,
    });
    check(
      !labNavigation?.errorText && !labNavigation?.isDownload,
      "loopback-navigation-rejected",
    );
    await waitBooleans(
      `({expected:location.href===${JSON.stringify(labUrl.href)}})`,
      ["expected"],
    );
    report.phase = "loopback-attestation";
    const lab = await evaluate(
      `(async()=>{if(location.href!==${JSON.stringify(labUrl.href)})return false;const c=new AbortController(),t=setTimeout(()=>c.abort(),3000);try{const r=await fetch('/api/perf-lab',{redirect:'error',cache:'no-store',signal:c.signal});if(!r.ok)return false;const v=await r.json();return v.provenance==='isolated-seeded-app'&&v.productionDatabase===false&&v.authentication==='stubbed-seeded-user'&&v.userId==='perf-lab-user'}finally{clearTimeout(t)}})()`,
    );
    report.checks.loopbackAttested = lab === true;
    check(lab === true, "loopback-attestation-failed");
    report.status = "diagnostic-only";
  } catch (error) {
    report.errorKind =
      error instanceof CdpTransportError
        ? error.kind
        : "setup-or-transport-error";
    if (Number.isInteger(error.code)) report.errorCode = error.code;
  } finally {
    pageConnection?.close();
    browserConnection?.close();
    report.cleanup = {
      method: "http-close-created-id",
      attempted: Boolean(targetId),
      acknowledged: false,
    };
    if (targetId) {
      try {
        const cleanupMs = Math.min(
          8_000,
          Math.floor(started + 58_000 - performance.now()),
        );
        check(cleanupMs > 0, "cleanup-deadline");
        const response = await fetch(
          new URL(`/json/close/${targetId}`, debug),
          {
            redirect: "error",
            signal: AbortSignal.timeout(cleanupMs),
          },
        );
        report.cleanup.acknowledged = response.ok;
        report.cleanup.httpStatus = response.status;
        // Closing needs the HTTP acknowledgment, not a response body. Do not
        // let stream cancellation consume the report-writing reserve.
        void response.body?.cancel().catch(() => {});
      } catch {
        report.cleanup.errorKind = "cleanup-failed-or-deadline";
      }
    }
    report.elapsedMs = Math.round(performance.now() - started);
  }
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const watchdog = setTimeout(() => {
    console.error(
      "Phone diagnostic reached its 60-second hard limit; no accepted evidence.",
    );
    process.exit(1);
  }, 60_000);
  try {
    const report = await diagnose();
    const output = path.resolve(
      process.env.PERF_PHONE_DIAGNOSTIC_OUTPUT ??
        `perf/artifacts/phone-protocol-diagnostic-${Date.now()}.json`,
    );
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.log(
      "Owned-target protocol diagnostic saved; physical phone evidence remains zero.",
    );
    process.exitCode =
      report.status === "diagnostic-only" && report.cleanup.acknowledged
        ? 0
        : 1;
  } catch {
    console.error(
      "Phone diagnostic report could not be saved; no accepted evidence.",
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
  }
  // A WebSocket closing handshake must not keep this manual CLI alive.
  process.exit(process.exitCode ?? 1);
}
