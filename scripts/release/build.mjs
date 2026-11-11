#!/usr/bin/env node
import { mkdir, realpath, rename, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { files, retainStatic, compressStatic } from './static-assets.mjs';

const root = process.cwd();
const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination)) throw Error('Usage: node scripts/release/build.mjs /absolute/new-build-directory');
// A fixed builder, checkout path and output path avoid webpack/Turbopack churn.
const staging = '.next-release-build';
for (const dir of [staging, destination]) {
  try { await stat(dir); throw Error(`Refusing to replace existing directory: ${dir}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const active = await realpath('.next');
const previous = path.join(active, 'static');
const previousNames = new Set((await files(previous)).filter(name => name.endsWith('.js')));
await mkdir('.tmp', { recursive: true });
// Next adds its generated types to this private copy, preserving the dirty source config.
const parsed = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (parsed.error) throw Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
const config = parsed.config;
config.compilerOptions = { ...config.compilerOptions, baseUrl: '..' };
config.include = ['../next-env.d.ts', '../src/**/*.ts', '../src/**/*.tsx', '../' + staging + '/types/**/*.ts'];
config.exclude = ['../node_modules'];
await writeFile('.tmp/release-tsconfig.json', JSON.stringify(config, null, 2));
const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], {
  stdio: 'inherit', env: { ...process.env, NEXT_DIST_DIR: staging, NEXT_TSCONFIG_PATH: '.tmp/release-tsconfig.json', NEXT_TELEMETRY_DISABLED: '1' },
});
if (result.status !== 0) throw Error(`Build failed (${result.status}); staging kept for inspection`);
const currentNames = (await files(path.join(staging, 'static'))).filter(name => name.endsWith('.js'));
const delta = { previous: previousNames.size, current: currentNames.length,
  reused: currentNames.filter(name => previousNames.has(name)).length,
  added: currentNames.filter(name => !previousNames.has(name)).length };
const retained = await retainStatic(previous, path.join(staging, 'static'));
const compression = await compressStatic(path.join(staging, 'static'));
const report = { builder: 'webpack', source: root, previousBuild: active, delta, retained, compression };
await writeFile(path.join(staging, 'release-assets.json'), JSON.stringify(report, null, 2) + '\n');
await mkdir(path.dirname(destination), { recursive: true });
await rename(staging, destination);
console.log(JSON.stringify({ destination, ...report }, null, 2));
console.log('Prepared only. No symlink, service, worker or database was changed.');
