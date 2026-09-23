#!/usr/bin/env node
// Dry run by default. --apply retains the active build and two newest rollbacks.
import { readdir, stat, lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const active = await realpath(path.join(root, ".next"));
async function bytes(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await bytes(target);
    else total += (await lstat(target)).size;
  }
  return total;
}
const builds = [];
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\.next(?:-|\.prev$)/.test(entry.name)) continue;
  const dir = path.join(root, entry.name);
  try {
    const built = await stat(path.join(dir, "BUILD_ID"));
    if (!(await stat(path.join(dir, "server"))).isDirectory()) continue;
    builds.push({ name: entry.name, dir, built: built.mtimeMs, bytes: await bytes(dir) });
  } catch { /* Incomplete/unknown directories require separate inspection. */ }
}
builds.sort((a, b) => b.built - a.built);
const keep = new Set([active, ...builds.filter(b => b.dir !== active).slice(0, 2).map(b => b.dir)]);
const remove = builds.filter(b => !keep.has(b.dir));
if (process.argv.includes("--apply")) {
  // Recheck immediately before deleting: a concurrent deployment may change it.
  for (const build of remove) {
    if (await realpath(path.join(root, ".next")) !== active) throw Error("Active build changed; stopped pruning");
    await rm(build.dir, { recursive: true });
  }
}
console.log(JSON.stringify({ applied: process.argv.includes("--apply"), kept: builds.filter(b => keep.has(b.dir)).map(b => b.name), removed: remove.map(b => b.name), bytes: remove.reduce((sum, b) => sum + b.bytes, 0) }, null, 2));
