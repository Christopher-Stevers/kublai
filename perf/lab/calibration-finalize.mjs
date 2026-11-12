// This final audit runs post-capture. Reviewed stage/Next supervisors DO poll
// ownership every100ms during the new method; that overhead is held identical.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";
const root = process.argv[2],
  input = Number(process.argv[3]);
if (
  !root?.startsWith("/tmp/foremanhq-calibration15-") ||
  root.split("/").includes("..")
)
  throw Error("Owned stage required");
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f)));
const result = {
  inputExitCode: input,
  forced: false,
  errors: [],
  observedAt: new Date().toISOString(),
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const identity = (pid) => {
  try {
    const s = fs.readFileSync(`/proc/${pid}/stat`, "utf8"),
      f = s
        .slice(s.lastIndexOf(")") + 1)
        .trim()
        .split(/\s+/);
    return {
      pid: Number(pid),
      state: f[0],
      pgid: Number(f[2]),
      startTime: f[19],
    };
  } catch {
    return null;
  }
};
try {
  if (fs.existsSync(root + "/active-next-record")) {
    const record = fs.readFileSync(root + "/active-next-record", "utf8").trim();
    if (
      !record.startsWith(root + "/cells/") ||
      record.split("/").includes("..")
    )
      throw Error("Owned Next record path differs");
    result.forced = true;
    const stopped = spawnSync(
      "python3",
      [
        process.env.PERF_HARNESS_DIR + "/perf/lab/owned-process-supervisor.py",
        "stop",
        "--record",
        record,
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    fs.writeFileSync(
      root + "/emergency-next-stop.log",
      (stopped.stdout ?? "") + (stopped.stderr ?? ""),
    );
    if (stopped.status !== 0) throw Error("Owned Next supervisor stop failed");
  }
  if (fs.existsSync(root + "/browser-identity.json")) {
    const owner = read("browser-identity.json");
    const members = () =>
      fs
        .readdirSync("/proc")
        .filter((x) => /^\d+$/.test(x))
        .map(identity)
        .filter((x) => x && x.state !== "Z" && x.pgid === owner.pgid);
    let group = members();
    if (group.length) {
      for (const p of group) {
        const bytes = fs.readFileSync(`/proc/${p.pid}/environ`);
        if (
          !bytes
            .toString()
            .split("\0")
            .includes("PERF_CALIBRATION_BROWSER_TOKEN=" + owner.token)
        )
          throw Error("Unknown browser group member; refuse to signal");
      }
      result.forced = true;
      process.kill(-owner.pgid, "SIGTERM");
      for (let i = 0; i < 30 && members().length; i++) await pause(100);
      if (members().length) process.kill(-owner.pgid, "SIGKILL");
      for (let i = 0; i < 20 && members().length; i++) await pause(100);
      if (members().length) throw Error("Owned browser group remains");
    }
    result.browserGroupAbsent = members().length === 0;
  } else if (input === 0) throw Error("Missing browser ownership record");
  if (fs.existsSync(root + "/private-runtime.json")) {
    const r = read("private-runtime.json");
    if (!r.socket.startsWith("/tmp/foremanhq-perf-pg."))
      throw Error("Private socket differs");
    if (fs.existsSync(r.socket)) {
      result.forced = true;
      const stopped = spawnSync(
        "timeout",
        [
          "--kill-after=2s",
          "8s",
          "/home/tim/.local/pgsql-18/bin/pg_ctl",
          "-D",
          r.socket + "/data",
          "-m",
          "immediate",
          "-t",
          "5",
          "stop",
        ],
        { encoding: "utf8" },
      );
      fs.writeFileSync(
        root + "/emergency-pg-stop.log",
        (stopped.stdout ?? "") + (stopped.stderr ?? ""),
      );
      if (stopped.status !== 0) throw Error("Private PG emergency stop failed");
      if (fs.existsSync(r.socket + "/server.log"))
        fs.copyFileSync(
          r.socket + "/server.log",
          root + "/emergency-pg-final.log",
        );
    }
    result.postgresAbsent = !identity(r.postgresPid);
    if (!result.postgresAbsent) throw Error("Private PG remains");
    result.privateSocketRemoved = !fs.existsSync(r.socket);
    if (!result.privateSocketRemoved)
      result.errors.push(
        "Owned stopped raw PG preserved for review; not a valid capture",
      );
  }
  const portOpen = await new Promise((resolve) => {
    const s = net.createConnection({ host: "127.0.0.1", port: 3481 });
    s.setTimeout(500);
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
    s.once("timeout", () => {
      s.destroy();
      resolve(true);
    });
  });
  result.portClosed = !portOpen;
  if (portOpen) throw Error("Stage port remains open");
} catch (e) {
  result.errors.push(e.message);
}
result.passed = input === 0 && !result.forced && !result.errors.length;
fs.writeFileSync(
  root + "/final-cleanup.json",
  JSON.stringify(result, null, 2) + "\n",
);
if (!result.passed) process.exitCode = 1;
