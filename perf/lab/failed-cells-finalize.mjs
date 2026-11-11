// Post-runtime ownership checks only; never connects to a database.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
const root = process.argv[2];
if (root !== "/tmp/foremanhq-failed-cells-v1-attempt1")
  throw Error("Owned result root required");
const result = {
  inputExitCode: Number(process.argv[3]),
  ownerAdjustedExitCode: Number(process.argv[4]),
  roles: {},
  processes: {},
  methodAfter: {},
  capturedAt: new Date().toISOString(),
};
let failed = false;
const read = (file) => JSON.parse(fs.readFileSync(file));
const hash = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const identityPresent = (item) => {
  try {
    const text = fs.readFileSync(`/proc/${item.pid}/stat`, "utf8");
    return (
      text
        .slice(text.lastIndexOf(")") + 1)
        .trim()
        .split(/\s+/)[19] === item.startTime
    );
  } catch {
    return false;
  }
};
for (const file of [
  "baseline/next-processes.json",
  "baseline/pg-owner-processes.json",
  "candidate/next-processes.json",
  "candidate/pg-owner-processes.json",
  "driver-processes.json",
]) {
  try {
    const record = read(path.join(root, file));
    const absent =
      !identityPresent(record.supervisor) &&
      record.processes.every((item) => !identityPresent(item));
    result.processes[file] = {
      status: record.status,
      familyAbsent: record.familyAbsent,
      ownedIdentitiesAbsent: record.ownedIdentitiesAbsent,
      allRecordedIdentitiesAbsent: absent,
      rootExitCode: record.rootExitCode,
      timedOut: record.timedOut,
    };
    if (
      record.status !== "stopped" ||
      !record.familyAbsent ||
      !record.ownedIdentitiesAbsent ||
      !absent ||
      record.timedOut
    )
      failed = true;
  } catch (error) {
    result.processes[file] = { incomplete: true, kind: error.name };
    failed = true;
  }
}
for (const role of ["baseline", "candidate"]) {
  try {
    const dir = path.join(root, role),
      config = read(path.join(dir, "runtime-config.json"));
    const pid = fs.existsSync(config.serverPid)
      ? fs.readFileSync(config.serverPid, "utf8").trim()
      : null;
    const socket = path.dirname(config.databaseLog),
      port = Number(new URL(config.base).port);
    const open = await new Promise((resolve) => {
      const client = net.createConnection({ host: "127.0.0.1", port });
      client.setTimeout(500);
      client.once("connect", () => {
        client.destroy();
        resolve(true);
      });
      client.once("error", () => resolve(false));
      client.once("timeout", () => {
        client.destroy();
        resolve(true);
      });
    });
    const errors = read(path.join(dir, "pg-errors.json")).errors,
      cleanup = read(path.join(dir, "cleanup.json"));
    const before = read(path.join(dir, "source-before.json")),
      after = read(path.join(dir, "source-after.json"));
    const sourceMatches =
      after.sourceFingerprint === before.sourceFingerprint &&
      after.sourceBuild === before.sourceBuild &&
      after.labBuild === config.expectedLabBuild;
    const schemaSame =
      fs.readFileSync(path.join(dir, "pg-schema-inventory.json"), "utf8") ===
      fs.readFileSync(path.join(dir, "schema-inventory-before.json"), "utf8");
    const pgUnexpected = (
      fs
        .readFileSync(path.join(dir, "pg-server.log"), "utf8")
        .match(/\b(ERROR|FATAL):/g) ?? []
    ).length;
    const healthy =
      sourceMatches &&
      schemaSame &&
      pgUnexpected === 0 &&
      (cleanup.finalExitCode === 0 || cleanup.finalExitCode === 143) &&
      pid !== null &&
      !fs.existsSync("/proc/" + pid) &&
      !fs.existsSync(socket) &&
      !open &&
      Array.isArray(errors) &&
      errors.length === 0 &&
      cleanup.copyFailed === 0;
    result.roles[role] = {
      pid: pid ? Number(pid) : null,
      pidAbsent: pid !== null && !fs.existsSync("/proc/" + pid),
      socketAbsent: !fs.existsSync(socket),
      portClosed: !open,
      errors,
      cleanup,
      sourceMatches,
      schemaSame,
      pgUnexpected,
      healthy,
    };
    if (!healthy) failed = true;
  } catch (error) {
    result.roles[role] = { setupOrCleanupIncomplete: true, kind: error.name };
    failed = true;
  }
}
try {
  const method = process.env.PERF_FAILED_CELLS_METHOD_ROOT,
    bytes = fs.readFileSync(path.join(method, "METHOD.json"));
  if (!bytes.equals(fs.readFileSync(root + "/method-before.json")))
    failed = true;
  for (const [file, expected] of Object.entries(JSON.parse(bytes).files)) {
    const actual = hash(path.join(method, file));
    result.methodAfter[file] = actual;
    if (actual !== expected) failed = true;
  }
  if (fs.existsSync(root + "/config.json")) {
    result.configSha256After = hash(root + "/config.json");
    result.configUnchanged =
      result.configSha256After === read(root + "/config-before.json").sha256;
    if (!result.configUnchanged) failed = true;
  }
} catch (error) {
  result.methodCheckFailure = error.name;
  failed = true;
}
result.cleanupPassed = !failed;
fs.writeFileSync(
  root + "/final-cleanup.json",
  JSON.stringify(result, null, 2) + "\n",
);
if (failed) process.exitCode = 1;
