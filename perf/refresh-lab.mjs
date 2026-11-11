import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sourceEvidence } from "../scripts/release/source-fingerprint.mjs";
const target = fs.realpathSync(process.env.PERF_REUSE_SNAPSHOT ?? "");
if (
  !target.startsWith("/tmp/foremanhq-speed-app-") ||
  !fs.existsSync(path.join(target, "PERF_LAB_ONLY"))
)
  throw new Error("Only a generated marked lab snapshot can be reused");
if (
  !fs
    .readFileSync(path.join(target, "next.config.js"), "utf8")
    .includes("const labDatabase = new URL(process.env.PERF_LAB_DATABASE_URL")
)
  throw new Error(
    "Snapshot lacks validated runtime socket binding; rebuild it",
  );
const database = new URL(process.env.PERF_LAB_DATABASE_URL ?? "http://invalid");
const socket = database.searchParams.get("host");
if (
  database.pathname !== "/foremanhq_perf_lab" ||
  !socket?.startsWith("/tmp/foremanhq-perf-pg.") ||
  !fs.existsSync(`${socket}/.s.PGSQL.55463`)
)
  throw new Error("Fresh private lab socket required");
const source = fs.realpathSync(process.env.PERF_SOURCE_ROOT ?? process.cwd());
const sourceBuild = fs
  .readFileSync(
    path.join(process.env.PERF_SOURCE_BUILD_DIST, "BUILD_ID"),
    "utf8",
  )
  .trim();
const evidence = await sourceEvidence(source, target, sourceBuild);
const prior = JSON.parse(
  fs.readFileSync(path.join(target, "source-evidence.json")),
);
if (
  prior.sourceBuild !== evidence.sourceBuild ||
  prior.sourceFingerprint !== evidence.sourceFingerprint
)
  throw new Error("Built lab snapshot belongs to different release source");
const fixture = JSON.parse(fs.readFileSync(process.env.PERF_LAB_FIXTURES));
if (
  fixture.provenance !== "isolated-seeded-app" ||
  fixture.productionDatabase !== false
)
  throw new Error("Synthetic fixture attestation required");
fs.copyFileSync(
  process.env.PERF_LAB_FIXTURES,
  path.join(target, "perf/fixtures.json"),
);
fs.rmSync(path.join(target, "uploads"), { recursive: true, force: true });
execFileSync("rsync", ["-a", `${process.env.PERF_LAB_ASSETS}/`, `${target}/`]);
const harness = path.dirname(new URL(import.meta.url).pathname);
for (const name of [
  "run.mjs",
  "journeys.mjs",
  "preflight.mjs",
  "idle.mjs",
  "check.mjs",
  "budgets.json",
  "summarize.mjs",
])
  fs.copyFileSync(path.join(harness, name), path.join(target, "perf", name));
fs.cpSync(path.join(harness, "lab"), path.join(target, "perf/lab"), {
  recursive: true,
});
fs.writeFileSync(
  path.join(target, "source-evidence.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(target);
