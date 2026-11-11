// Supplemental, non-streaming read timing. This never changes the journey gate.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function readServerTiming(value) {
  const entries = new Map();
  for (const entry of (value ?? "").split(",")) {
    const [name, ...parameters] = entry.trim().split(";");
    if (!["app", "db"].includes(name)) continue;
    if (entries.has(name)) throw Error("Duplicate server timing metric");
    // A streaming header measures only work before headers. Never relabel it
    // as a complete non-streaming response or replace it with client wallclock.
    if (parameters.some((parameter) => /^\s*desc\s*=/.test(parameter)))
      throw Error("Partial server timing is not accepted by this protocol");
    const durations = parameters.filter((parameter) =>
      /^\s*dur\s*=/.test(parameter),
    );
    if (durations.length !== 1) throw Error("Missing or ambiguous duration");
    const raw = durations[0].match(
      /^\s*dur\s*=\s*((?:0|[1-9]\d*)(?:\.\d+)?)\s*$/,
    )?.[1];
    if (raw === undefined) throw Error("Invalid server duration");
    const duration = Number(raw);
    if (!Number.isFinite(duration)) throw Error("Invalid server duration");
    entries.set(name, duration);
  }
  if (!entries.has("app") || !entries.has("db"))
    throw Error("Both server app and database durations are required");
  return { appMs: entries.get("app"), databaseMs: entries.get("db") };
}

const quantile = (values, proportion) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * proportion) - 1)];
};
export function summarizeReads(samples) {
  if (!samples.length) throw Error("No measured reads");
  const procedures = [...new Set(samples.map((sample) => sample.procedure))];
  const summary = (rows) => ({
    count: rows.length,
    appMedianMs: quantile(
      rows.map((row) => row.appMs),
      0.5,
    ),
    appP95Ms: quantile(
      rows.map((row) => row.appMs),
      0.95,
    ),
    databaseP95Ms: quantile(
      rows.map((row) => row.databaseMs),
      0.95,
    ),
  });
  return {
    aggregate: summary(samples),
    byProcedure: Object.fromEntries(
      procedures.map((procedure) => [
        procedure,
        summary(samples.filter((sample) => sample.procedure === procedure)),
      ]),
    ),
  };
}

function isolatedOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("Explicit loopback isolated origin required");
  return url;
}
const databaseErrors = (text) => ({
  errors: (text.match(/^\d{4}-\d{2}-\d{2}.*?\bERROR:/gm) ?? []).length,
  fatal: (text.match(/^\d{4}-\d{2}-\d{2}.*?\bFATAL:/gm) ?? []).length,
});
const requiredProcedures = [
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

async function verifyLabProcess(pid, root, pg) {
  if (!/^[1-9]\d*$/.test(pid ?? ""))
    throw Error("Explicit co-started lab server PID required");
  const cwd = await fs.realpath(`/proc/${pid}/cwd`);
  // Consume environment locally without ever printing values or including them
  // in a report. This protocol runs on the existing Linux test machine only.
  const environment = new Map(
    (await fs.readFile(`/proc/${pid}/environ`, "utf8"))
      .split("\0")
      .map((entry) => {
        const split = entry.indexOf("=");
        return [entry.slice(0, split), entry.slice(split + 1)];
      }),
  );
  const database = new URL(environment.get("PERF_LAB_DATABASE_URL"));
  if (
    cwd !== root ||
    environment.get("PERF_LAB_SOCKET") !== pg ||
    database.pathname !== "/foremanhq_perf_lab" ||
    database.searchParams.get("host") !== pg ||
    database.searchParams.get("port") !== "55463"
  )
    throw Error(
      "Lab process does not match source directory and private database",
    );
}

export async function measureServerReads(env = process.env) {
  const base = isolatedOrigin(env.PERF_BASE_URL);
  const root = await fs.realpath(env.PERF_SERVER_READ_ROOT);
  const pg = await fs.realpath(env.PERF_LAB_SOCKET);
  if (!pg.startsWith("/tmp/foremanhq-perf-pg."))
    throw Error("Private lab database required");
  await fs.access(path.join(root, "PERF_LAB_ONLY"));
  const readJson = async (file) =>
    JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
  const source = await readJson("source-evidence.json");
  const fixture = await readJson("perf/fixtures.json");
  const preflight = await readJson("preflight.json");
  const build = (
    await fs.readFile(path.join(root, ".next/BUILD_ID"), "utf8")
  ).trim();
  if (
    !/^[a-z0-9_-]+$/i.test(build) ||
    build !== env.PERF_BUILD ||
    !/^[a-f0-9]{64}$/.test(source.sourceFingerprint) ||
    !/^[a-f0-9]{64}$/.test(source.sourceBuild ?? "") ||
    fixture.provenance !== "isolated-seeded-app" ||
    fixture.productionDatabase !== false ||
    fixture.userId !== "perf-lab-user" ||
    preflight.status !== "passed" ||
    preflight.build !== build ||
    preflight.sourceBuild !== source.sourceBuild ||
    preflight.sourceFingerprint !== source.sourceFingerprint ||
    preflight.results?.length !== 14 ||
    preflight.results.some((result) => result.status !== "ok") ||
    requiredProcedures.some(
      (name) => !preflight.results.some((result) => result.procedure === name),
    )
  )
    throw Error(
      "Matching source-bound synthetic fixture and 14-query preflight required",
    );
  await verifyLabProcess(env.PERF_SERVER_PID, root, pg);
  const deadline = AbortSignal.timeout(120_000);
  const methodBefore = createHash("sha256")
    .update(await fs.readFile(new URL(import.meta.url)))
    .digest("hex");
  const fetchJson = async (url) => {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    if (!response.ok || body.error)
      throw Error("Synthetic read failed; payload omitted");
    return { response, body };
  };
  const { body: attestation } = await fetchJson(new URL("/api/perf-lab", base));
  if (
    attestation.provenance !== "isolated-seeded-app" ||
    attestation.productionDatabase !== false ||
    attestation.authentication !== "stubbed-seeded-user" ||
    attestation.userId !== fixture.userId
  )
    throw Error("Disposable seeded app attestation required");
  // A current isolated Next server has no retained release corpus: its unique
  // compiled manifest path and bytes bind this origin to the selected lab build.
  const manifestName = `static/${build}/_buildManifest.js`;
  const expectedManifest = await fs.readFile(
    path.join(root, ".next", manifestName),
  );
  const manifestResponse = await fetch(
    new URL(`/_next/${manifestName}`, base),
    {
      redirect: "error",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
    },
  );
  if (
    !manifestResponse.ok ||
    !Buffer.from(await manifestResponse.arrayBuffer()).equals(expectedManifest)
  )
    throw Error(
      "Served lab manifest does not match the selected compiled build",
    );
  const log = () =>
    fs.readFile(path.join(pg, "server.log"), "utf8").then(databaseErrors);
  const before = await log();
  if (before.errors || before.fatal)
    throw Error("Fixture already has database errors");
  // Fixed endpoints match the reviewed read preflight. No method, input, URL or
  // procedure comes from an arbitrary command-line argument or remote payload.
  const queries = [
    ["user.getMe"],
    ["notifications.identity", { sessionKey: "perf-lab-session" }],
    ["push.identity", { sessionKey: "perf-lab-session" }],
    ["job.getJob", { jobId: fixture.jobId }],
    [
      "materialList.getMaterialList",
      { materialListId: fixture.materialListId },
    ],
    ["materialList.getOrderById", { orderId: fixture.orderId }],
    ["drawings.listSets", { jobId: fixture.jobId }],
    ["drawings.getSet", { setId: fixture.setId }],
    ["drawingsWorkspace.get", { sheetId: fixture.sheetId, deferLinks: true }],
    [
      "drawingsWorkspace.changes",
      { sheetId: fixture.sheetId, deferLinks: true },
    ],
    ["chat.getOverview", { jobId: fixture.jobId }],
    ["chat.history", { jobId: fixture.jobId, limit: 50 }],
    ["rooms.getJobRoomCount", { jobId: fixture.jobId }],
  ];
  const call = async ([procedure, input]) => {
    const url = new URL(`/api/trpc/${procedure}`, base);
    if (input !== undefined)
      url.searchParams.set("input", JSON.stringify({ json: input }));
    const { response, body } = await fetchJson(url);
    if (
      !/^application\/json(?:;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )
    )
      throw Error("Non-streaming JSON response required");
    return {
      body,
      timing: readServerTiming(response.headers.get("server-timing")),
    };
  };
  const timestamp = new Date().toISOString();
  // One recorded warm-up per endpoint, including the account-bound overview.
  const warmup = [];
  const samples = [];
  let status = "complete",
    phase = "warmup",
    failedAt;
  let after,
    methodSha256,
    processRechecked = false;
  try {
    for (const query of queries) {
      phase = `warmup:${query[0]}`;
      const { body, timing } = await call(query);
      warmup.push({ procedure: query[0], ...timing });
      if (query[0] === "notifications.identity") {
        const accountKey = (body.result?.data?.json ?? body.result?.data)
          ?.accountKey;
        if (typeof accountKey !== "string")
          throw Error("Synthetic account handshake failed");
        queries.push(["notifications.overview", { accountKey }]);
      }
    }
    for (let run = 0; run < 10; run++) {
      // Rotate deterministic order. Do not trim or discard measured samples.
      for (let offset = 0; offset < queries.length; offset++) {
        const query = queries[(run + offset) % queries.length];
        phase = `round:${run}:${query[0]}`;
        const { timing } = await call(query);
        samples.push({ procedure: query[0], run, ...timing });
      }
    }
    phase = "database-health";
    await verifyLabProcess(env.PERF_SERVER_PID, root, pg);
    processRechecked = true;
    after = await log();
    if (after.errors || after.fatal)
      throw Error("Database errors invalidate read timings");
    phase = "method-integrity";
    methodSha256 = createHash("sha256")
      .update(await fs.readFile(new URL(import.meta.url)))
      .digest("hex");
    if (methodSha256 !== methodBefore)
      throw Error("Measurement tool changed during capture");
  } catch {
    status = "failed";
    failedAt = phase;
    // Keep any completed samples when a later read fails; never publish a
    // shortened capture as a complete baseline or erase the failed attempt.
    after ??= await log().catch(() => null);
  }
  return {
    version: 1,
    protocol: "synthetic-nonstream-server-reads-v1",
    status,
    failedAt,
    methodSha256: methodBefore,
    methodAfter: methodSha256,
    timestamp,
    completedAt: new Date().toISOString(),
    build,
    sourceBuild: source.sourceBuild,
    sourceFingerprint: source.sourceFingerprint,
    provenance: "isolated-seeded-app",
    acceptedPhase0Gate: false,
    limits: [
      "Server-Timing app spans the route wrapper through non-streaming Response creation, including synthetic identity/context and serialization; excludes Next middleware, transport, and client parsing.",
      "Identity is stubbed; this is not live authentication or production workload timing.",
      "Complete captures have ten measured rounds per fixed endpoint with equal endpoint weights, not production traffic frequency. Partial failed-capture summaries are descriptive only and may have unequal weights.",
      "Database wait sums may exceed app elapsed time because work can overlap.",
      "Warm-ups retained separately; no measured samples discarded. Independent repeated captures remain required.",
    ],
    preflight: { status: preflight.status, count: preflight.results.length },
    processBinding: {
      before: true,
      after: processRechecked,
      method:
        "Co-started Linux server cwd and private database environment; matching manifest at origin. Caller supplies that server's loopback port.",
    },
    database: { before, after },
    warmup,
    samples,
    summary: samples.length ? summarizeReads(samples) : null,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const report = await measureServerReads();
    const output = path.resolve(
      process.env.PERF_SERVER_READ_OUTPUT ?? `server-reads-${Date.now()}.json`,
    );
    await fs.writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(
      `Saved ${report.status} capture with ${report.samples.length} synthetic non-streaming reads; Phase 0 remains unaccepted.`,
    );
    if (report.status !== "complete") process.exitCode = 1;
  } catch {
    console.error(
      "Server-read capture failed; no accepted evidence. Source, payloads and fixture identifiers omitted.",
    );
    process.exitCode = 1;
  }
}
