#!/usr/bin/env node
// Summarizes tRPC and Replicache pull timing lines from the ForemanHQ service journal.
// Usage: node scripts/trpc-timing-report.mjs [--since "-1 day"] [--limit 25]
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const since = option("--since", "-1 day");
const limit = Number(option("--limit", "25"));

const journal = execFileSync(
  "journalctl",
  ["--user", "-u", "foremenhq", "--since", since, "--no-pager", "-o", "cat"],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
);

const pattern =
  /\[TRPC\] ([\w.]+) took (\d+)ms to execute(?: \((\d+) queries\))?/;
const pullPattern = /\[replicache\] ([\w-]+) pull took (\d+)ms/;
const byPath = new Map();
for (const line of journal.split("\n")) {
  const pull = pullPattern.exec(line);
  const match =
    pattern.exec(line) ??
    (pull ? [pull[0], `replicache.${pull[1]}.pull`, pull[2], undefined] : null);
  if (!match) continue;
  const [, path, ms, queries] = match;
  const entry = byPath.get(path) ?? { durations: [], queries: [] };
  entry.durations.push(Number(ms));
  if (queries !== undefined) entry.queries.push(Number(queries));
  byPath.set(path, entry);
}

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];

const rows = [...byPath.entries()].map(([path, { durations, queries }]) => {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    path,
    calls: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1),
    queries: queries.length
      ? (queries.reduce((sum, n) => sum + n, 0) / queries.length).toFixed(1)
      : "-",
    total: sorted.reduce((sum, n) => sum + n, 0),
  };
});

rows.sort((a, b) => b.total - a.total);
console.log(`Request timings since ${since} (sorted by total time)\n`);
console.log(
  "procedure".padEnd(48) +
    "calls".padStart(7) +
    "p50 ms".padStart(9) +
    "p95 ms".padStart(9) +
    "max ms".padStart(9) +
    "queries".padStart(9),
);
for (const row of rows.slice(0, limit)) {
  console.log(
    row.path.padEnd(48) +
      String(row.calls).padStart(7) +
      String(row.p50).padStart(9) +
      String(row.p95).padStart(9) +
      String(row.max).padStart(9) +
      String(row.queries).padStart(9),
  );
}
