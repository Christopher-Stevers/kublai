#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { files } from '../scripts/release/static-assets.mjs';

const build = process.argv[2];
if (!build) throw Error('Usage: node perf/analyze-shared-bundle.mjs /canonical-build');
const sourceBuild = (await readFile(path.join(build, 'BUILD_ID'), 'utf8')).trim();
const recorded = JSON.parse(await readFile(path.join(build, 'analysis/client-stats.json'), 'utf8'));
if (recorded.sourceBuild !== sourceBuild || recorded.compiler !== 'canonical-webpack-client')
  throw Error('Client stats do not match the canonical build');
const manifest = JSON.parse(await readFile(path.join(build, 'build-manifest.json'), 'utf8'));
const root = manifest.rootMainFiles.filter(name => name.endsWith('.js'));
const routes = [];
for (const name of await files(path.join(build, 'server/app'))) {
  if (!name.endsWith('page_client-reference-manifest.js')) continue;
  const context = {};
  vm.runInNewContext(await readFile(path.join(build, 'server/app', name), 'utf8'), context, { timeout: 1000 });
  for (const [route, entry] of Object.entries(context.__RSC_MANIFEST)) {
    if (!route.startsWith('/jobs/')) continue;
    const chunks = new Set(root);
    for (const ref of Object.values(entry.clientModules))
      for (const chunk of ref.chunks) if (String(chunk).endsWith('.js')) chunks.add(decodeURIComponent(chunk));
    routes.push({ route, files: [...chunks] });
  }
}
if (!routes.length) throw Error('No jobs client manifests found');
const shared = routes[0].files.filter(file => routes.every(route => route.files.includes(file)));
const cleanName = input => {
  const name = String(input ?? 'unknown').replaceAll('\\', '/');
  const dependency = name.lastIndexOf('/node_modules/');
  if (dependency >= 0) return name.slice(dependency + 1);
  const source = name.lastIndexOf('/src/');
  if (source >= 0) return name.slice(source + 1);
  return name.replaceAll(process.cwd(), '<checkout>');
};
function leaves(modules = []) {
  return modules.flatMap(module => module.modules?.length ? leaves(module.modules) : [{
    id: module.id ?? null,
    name: cleanName(module.name ?? module.identifier),
    webpackEstimatedBytes: module.size ?? 0,
  }]);
}
const chunks = [];
for (const file of shared) {
  const bytes = await readFile(path.join(build, file));
  const chunk = recorded.stats.chunks.find(chunk => chunk.files?.includes(file));
  chunks.push({ file, rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length,
    modules: leaves(chunk?.modules).sort((a, b) => b.webpackEstimatedBytes - a.webpackEstimatedBytes),
  });
}
chunks.sort((a, b) => b.gzipBytes - a.gzipBytes);
console.log(JSON.stringify({
  sourceBuild,
  method: 'Actual canonical webpack module attribution for the intersection of jobs client-reference chunks plus root main files. Conditional references can overstate startup transfer. Gzip level 9 per emitted chunk; module sizes are compiler estimates, not additive gzip attribution.',
  sharedGzipBytes: chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
  routeCount: routes.length,
  chunks,
}, null, 2));
