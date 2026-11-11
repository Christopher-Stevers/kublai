#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { files } from './static-assets.mjs';
const [build, baseline] = process.argv.slice(2);
if (!build || !baseline) throw Error('Usage: node scripts/release/static-metrics.mjs /candidate/build /baseline/build');
const map = JSON.parse(execFileSync(process.execPath, [new URL('./script-map.mjs', import.meta.url).pathname, build], { encoding: 'utf8' }));
let names;
try { names = JSON.parse(await readFile(path.join(build, 'release-assets.json'))).currentScripts; }
catch (error) { if (error.code !== 'ENOENT') throw error; names = (await files(path.join(build, 'static'))).filter(name => name.endsWith('.js')); }
let deployGzipBytes = 0;
for (const name of names) {
  const data = await readFile(path.join(build, 'static', name));
  try { if (data.equals(await readFile(path.join(baseline, 'static', name)))) continue; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  deployGzipBytes += gzipSync(data, { level: 9 }).length;
}
console.log(JSON.stringify({ build: (await readFile(path.join(build, 'BUILD_ID'), 'utf8')).trim(), sharedGzipBytes: map.shared.gzipBytes, screenGzipBytes: Math.max(...map.routes.map(row => row.total.gzipBytes)), deployGzipBytes, screenGzipByRoute: Object.fromEntries(map.routes.map(row => [row.route, row.total.gzipBytes])), method: map.method }, null, 2));
