import fs from "node:fs";
const base = new URL(process.env.PERF_BASE_URL ?? "http://127.0.0.1:3481");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
  throw new Error("Preflight requires isolated loopback application");
const attestation = await fetch(new URL("/api/perf-lab", base)).then(
  (response) => response.json(),
);
if (
  attestation.provenance !== "isolated-seeded-app" ||
  attestation.productionDatabase !== false
)
  throw new Error("Disposable seeded app required");
const fixture = JSON.parse(
  fs.readFileSync(
    process.env.PERF_FIXTURES ?? new URL("./fixtures.json", import.meta.url),
  ),
);
const queries = [
  ["user.getMe"],
  ["notifications.identity", { sessionKey: "perf-lab-session" }],
  ["push.identity", { sessionKey: "perf-lab-session" }],
  ["job.getJob", { jobId: fixture.jobId }],
  ["materialList.getMaterialList", { materialListId: fixture.materialListId }],
  ["materialList.getOrderById", { orderId: fixture.orderId }],
  ["drawings.listSets", { jobId: fixture.jobId }],
  ["drawings.getSet", { setId: fixture.setId }],
  ["drawingsWorkspace.get", { sheetId: fixture.sheetId, deferLinks: true }],
  ["drawingsWorkspace.changes", { sheetId: fixture.sheetId, deferLinks: true }],
  ["chat.getOverview", { jobId: fixture.jobId }],
  ["chat.history", { jobId: fixture.jobId, limit: 50 }],
  ["rooms.getJobRoomCount", { jobId: fixture.jobId }],
];
const results = [];
for (const [procedure, input] of queries) {
  const url = new URL(`/api/trpc/${procedure}`, base);
  if (input !== undefined)
    url.searchParams.set("input", JSON.stringify({ json: input }));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body.error) {
    const code =
      body.error?.json?.data?.code ?? body.error?.data?.code ?? response.status;
    fs.writeFileSync(
      process.env.PERF_PREFLIGHT_OUTPUT ?? "preflight.json",
      JSON.stringify({ status: "failed", procedure, code, results }, null, 2),
    );
    throw new Error(
      `Read endpoint preflight failed ${procedure}: ${code}; payload/SQL/fixture IDs omitted`,
    );
  }
  if (procedure === "notifications.identity") {
    const accountKey = (body.result?.data?.json ?? body.result?.data)
      ?.accountKey;
    if (typeof accountKey !== "string")
      throw new Error("Notification account handshake failed");
    queries.push(["notifications.overview", { accountKey }]);
  }
  results.push({ procedure, status: "ok" });
}
const source = fs.existsSync("source-evidence.json")
  ? JSON.parse(fs.readFileSync("source-evidence.json"))
  : {};
fs.writeFileSync(
  process.env.PERF_PREFLIGHT_OUTPUT ?? "preflight.json",
  JSON.stringify(
    {
      status: "passed",
      build: process.env.PERF_BUILD ?? "unknown",
      ...source,
      results,
    },
    null,
    2,
  ),
);
console.log(
  `Read endpoint preflight passed ${results.length} actual application queries.`,
);
