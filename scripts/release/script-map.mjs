#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { files } from './static-assets.mjs';
const build = process.argv[2] ?? '.next';
const manifest = JSON.parse(await readFile(path.join(build, 'build-manifest.json'), 'utf8'));
const root = manifest.rootMainFiles.filter(name => name.endsWith('.js'));
const routes = [];
for (const name of await files(path.join(build, 'server/app'))) {
  if (!name.endsWith('page_client-reference-manifest.js')) continue;
  const context = {};
  vm.runInNewContext(await readFile(path.join(build, 'server/app', name), 'utf8'), context);
  for (const [route, entry] of Object.entries(context.__RSC_MANIFEST)) {
    const chunks = new Set(root);
    for (const ref of Object.values(entry.clientModules)) {
      for (const chunk of ref.chunks) if (String(chunk).endsWith('.js')) chunks.add(decodeURIComponent(chunk));
    }
    routes.push({ route, files: [...chunks].sort() });
  }
}
const jobs = routes.filter(row => row.route.startsWith('/jobs/'));
const shared = jobs[0].files.filter(file => jobs.every(row => row.files.includes(file)));
const sizes = new Map();
async function size(names) {
  let raw = 0, gzip = 0;
  for (const name of names) {
    if (!sizes.has(name)) {
      const data = await readFile(path.join(build, name));
      sizes.set(name, { raw: data.length, gzip: gzipSync(data, { level: 9 }).length });
    }
    const item = sizes.get(name); raw += item.raw; gzip += item.gzip;
  }
  return { count: names.length, rawBytes: raw, gzipBytes: gzip };
}
for (const row of routes) {
  row.total = await size(row.files);
  row.additionalToJobsShared = await size(row.files.filter(name => !shared.includes(name)));
}
console.log(JSON.stringify({ method: 'Union of client-reference manifest JS chunks plus rootMainFiles; jobs shared is intersection across all jobs page manifests. Gzip level 9 per file. Manifest dependency map, not browser request trace; conditional references may overstate actual startup.', shared: await size(shared), routes: routes.map(({ files, ...metadata }) => metadata) }, null, 2));
