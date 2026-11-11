// Owns only the supplemental driver/proxy/browser group. Caller owns and must
// stop the two isolated Next servers and private PostgreSQL in its own finally.
// Not executed/validated yet; this is source-only preparation.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.NEXT_CACHE_FUNCTIONAL_INPUT) throw Error("Explicit isolated input file required");
const attempt = await fs.mkdtemp(path.join(os.tmpdir(), "foremanhq-next-functional-attempt-"));
const child = spawn(process.execPath, [path.join(here, "next-cache-functional.mjs")], {
  detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_FUNCTIONAL_SUPERVISED: "1" },
});
const out = [], err = [];
child.stdout.on("data", bytes => out.push(bytes)); child.stderr.on("data", bytes => err.push(bytes));
const stop = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } } };
let timedOut = false, interrupted = false;
const deadline = setTimeout(() => { timedOut = true; stop(); }, 240_000);
const interrupt = () => { interrupted = true; stop(); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
let code = 1, signal = null, spawnError = null;
try {
  ({ code, signal } = await new Promise(resolve => {
    child.once("error", error => { spawnError = error.message; resolve({ code: 1, signal: null }); });
    child.once("close", (code, signal) => resolve({ code, signal }));
  }));
} finally {
  clearTimeout(deadline); stop();
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  await fs.writeFile(path.join(attempt, "stdout.json"), Buffer.concat(out));
  await fs.writeFile(path.join(attempt, "stderr.log"), Buffer.concat(err));
}
let report;
try { report = JSON.parse(Buffer.concat(out).toString()); }
catch { report = { protocol: "next-cache-functional-v1", status: "failed", error: "Incomplete worker report" }; }
if (timedOut || interrupted || spawnError || code !== 0) report.status = "failed";
report.supervisor = { timedOut, interrupted, spawnError, exitCode: code, signal, attemptDirectory: attempt,
  callerOwnsBackendAndDatabaseCleanup: true };
await fs.writeFile(path.join(attempt, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
process.exitCode = code === 0 && !timedOut && !interrupted && !spawnError ? 0 : 1;
