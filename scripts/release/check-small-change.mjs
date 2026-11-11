#!/usr/bin/env node
// Read-only check after two real canonical builds; never starts a build or server.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
const [baseline, candidate, limitArgument = '100000'] = process.argv.slice(2);
if (!baseline || !candidate) throw Error('Usage: node scripts/release/check-small-change.mjs /baseline /candidate [gzip-byte-limit=100000]');
const limit = Number(limitArgument);
if (!Number.isSafeInteger(limit) || limit <= 0) throw Error('Budget must be a positive integer');
async function manifest(dir) {
  const report = JSON.parse(await readFile(path.join(dir, 'release-assets.json'), 'utf8'));
  if (!Array.isArray(report.currentScripts) || !report.currentScripts.length) throw Error('Need canonical release manifest with currentScripts');
  return report;
}
const before = await manifest(baseline), after = await manifest(candidate);
const oldNames = new Set(before.currentScripts);
let changed = 0, reused = 0, gzipBytes = 0, rawBytes = 0;
for (const name of after.currentScripts) {
  const data = await readFile(path.join(candidate, 'static', name));
  if (oldNames.has(name)) {
    const old = await readFile(path.join(baseline, 'static', name));
    if (!data.equals(old)) throw Error('Immutable script URL collision; byte-budget comparison is invalid');
    reused++;
  } else {
    changed++; rawBytes += data.length; gzipBytes += gzipSync(data, { level: 9 }).length;
  }
}
const evidence = {
  baselineBuild: before.sourceHash,
  candidateBuild: after.sourceHash,
  method: 'All changed current JavaScript files, gzip level 9 per file; retained history excluded. This is an upper-bound update payload, not a browser download trace.',
  currentScripts: after.currentScripts.length, reusedScripts: reused, changedScripts: changed,
  changedRawBytes: rawBytes, changedGzipBytes: gzipBytes,
  budgetGzipBytes: limit, passes: gzipBytes < limit,
};
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.passes) process.exitCode = 1;
