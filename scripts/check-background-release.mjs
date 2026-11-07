import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Run after deploying changes used by the separate worker. Checking the web
// health endpoint alone cannot establish which code processes queued jobs.
const expected = process.argv[2];
if (!expected || !/^[a-f0-9]{40}$/.test(expected))
  throw Error("Supply the full expected release commit");
const pid = execFileSync("systemctl", [
  "--user", "show", "foremanhq-worker.service", "--property=MainPID", "--value",
], { encoding: "utf8" }).trim();
if (!/^\d+$/.test(pid) || pid === "0") throw Error("Background worker is not running");
const environment = fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
const release = environment.find((entry) => entry.startsWith("NEXT_PUBLIC_APP_RELEASE="))?.split("=")[1];
const bundle = JSON.parse(fs.readFileSync(".background/current/release.json", "utf8"));
if (release !== expected || bundle.commit !== expected)
  throw Error(`Background release mismatch: running ${release ?? "unknown"}, selected ${bundle.commit}, expected ${expected}`);
console.log(`Background worker verified at ${expected}`);
