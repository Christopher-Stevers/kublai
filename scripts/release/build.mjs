#!/usr/bin/env node
import { mkdir, realpath, rename, writeFile, stat, symlink, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import ts from 'typescript';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { assertDisposableWorkspace, assertInputSymlinks } from './canonical-guards.mjs';
import { files, retainStatic, compressStatic } from './static-assets.mjs';

if (process.env.RELEASE_SOURCE_DIR) process.chdir(process.env.RELEASE_SOURCE_DIR);
const root = process.cwd();
try { await stat('PERF_LAB_ONLY'); throw Error('Refusing release build from disposable authentication-stub lab snapshot'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination)) throw Error('Usage: node scripts/release/build.mjs /absolute/new-build-directory');
// A fixed builder, checkout path and output path avoid webpack/Turbopack churn.
const staging = '.next-release-build';
for (const dir of [staging, destination]) {
  try { await stat(dir); throw Error(`Refusing to replace existing directory: ${dir}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const keyFile = process.env.RELEASE_KEY_FILE ?? path.join(homedir(), '.local/share/foremanhq-release/server-actions.key');
let encryptionKey = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
if (!encryptionKey) {
  await mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  try { await writeFile(keyFile, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  encryptionKey = (await readFile(keyFile, 'utf8')).trim();
}
// Generated Flight loader requests and dependency IDs contain source paths.
// Compile every caller's source at exactly one locked filesystem location.
const canonical = path.join(homedir(), '.cache/foremanhq-release-builder');
if (process.env.FOREMANHQ_CANONICAL_BUILD !== '1') {
  await assertDisposableWorkspace(canonical, { source: root, destination, active: await realpath('.next'), dependencies: await realpath('node_modules'), key: keyFile });
  const protectedInputs = { source: root, destination, active: await realpath('.next'), dependencies: await realpath('node_modules'), key: keyFile };
  for (const name of ['src', 'public', 'scripts', '.env', '.env.local', '.env.production', '.env.production.local']) {
    try { protectedInputs[name] = await realpath(path.join(root, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await assertDisposableWorkspace(canonical, protectedInputs);
  const inputs = ['src', 'public', 'scripts', '.env', '.env.local', '.env.production', '.env.production.local'].map(name => path.join(root, name));
  await assertInputSymlinks(canonical, inputs);
  const lock = canonical + '.lock';
  await mkdir(path.dirname(canonical), { recursive: true });
  try { await mkdir(lock); } catch (error) {
    if (error.code === 'EEXIST') throw Error('Canonical release builder is busy; wait for its current build');
    throw error;
  }
  try {
    protectedInputs.active = await realpath('.next');
    await assertDisposableWorkspace(canonical, protectedInputs);
    await assertInputSymlinks(canonical, inputs);
    await rm(canonical, { recursive: true, force: true });
    await mkdir(canonical);
    for (const dir of ['src', 'public', 'scripts']) await cp(path.join(root, dir), path.join(canonical, dir), { recursive: true });
    for (const name of ['next.config.js', 'postcss.config.js', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'next-env.d.ts']) {
      try { await cp(path.join(root, name), path.join(canonical, name)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
      try { await symlink(await realpath(path.join(root, name)), path.join(canonical, name)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await symlink(await realpath('node_modules'), path.join(canonical, 'node_modules'), 'dir');
    await symlink(await realpath('.next'), path.join(canonical, '.next'), 'dir');
    const child = spawnSync(process.execPath, [path.join(canonical, 'scripts/release/build.mjs'), destination], {
      cwd: canonical, stdio: 'inherit', env: { ...process.env, FOREMANHQ_CANONICAL_BUILD: '1', RELEASE_SOURCE_DIR: canonical, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: encryptionKey },
    });
    if (child.status !== 0) throw Error(`Canonical build failed (${child.status}); workspace retained at ${canonical}`);
  } finally { await rm(lock, { recursive: true }); }
  process.exit(0);
}
if (root !== canonical) throw Error('Canonical child must run in the fixed release workspace');
const fingerprint = createHash('sha256');
fingerprint.update(encryptionKey); // Stable private salt prevents Server Action IDs churning. 
for (const dir of ['src', 'public', 'scripts']) {
  for (const name of await files(dir)) {
    fingerprint.update(dir + '/' + name + '\0');
    fingerprint.update(await readFile(path.join(dir, name)));
  }
}
for (const name of ['next.config.js', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'postcss.config.js', '.env', '.env.local', '.env.production', '.env.production.local']) {
  fingerprint.update(name + '\0');
  try { fingerprint.update(await readFile(name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const name of Object.keys(process.env).filter(name => (name.startsWith('NEXT_PUBLIC_') && name !== 'NEXT_PUBLIC_BUILD_ID') || ['NODE_ENV', 'BROWSERSLIST'].includes(name)).sort()) {
  fingerprint.update(name + '\0' + process.env[name] + '\0');
}
const sourceHash = fingerprint.digest('hex');
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
  stdio: 'inherit', env: { ...process.env, NEXT_DIST_DIR: staging, RELEASE_BUILD_ID: sourceHash, NEXT_PUBLIC_BUILD_ID: sourceHash, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: encryptionKey, NEXT_TSCONFIG_PATH: '.tmp/release-tsconfig.json', NEXT_TELEMETRY_DISABLED: '1' },
});
if (result.status !== 0) throw Error(`Build failed (${result.status}); staging kept for inspection`);
const currentNames = (await files(path.join(staging, 'static'))).filter(name => name.endsWith('.js'));
const delta = { previous: previousNames.size, current: currentNames.length,
  reused: currentNames.filter(name => previousNames.has(name)).length,
  added: currentNames.filter(name => !previousNames.has(name)).length };
const retainedBuilds = [active, ...JSON.parse(process.env.RETAIN_NEXT_BUILDS ?? '[]')];
let retained = 0;
for (const retainedBuild of [...new Set(retainedBuilds)]) {
  if (!path.isAbsolute(retainedBuild)) throw Error('RETAIN_NEXT_BUILDS entries must be absolute build directories');
  await stat(path.join(retainedBuild, 'BUILD_ID'));
  retained += await retainStatic(path.join(retainedBuild, 'static'), path.join(staging, 'static'));
}
const compression = await compressStatic(path.join(staging, 'static'));
const report = { builder: 'webpack', sourceHash, source: root, previousBuild: active, delta, currentScripts: currentNames, retainedBuilds, retained, compression };
await writeFile(path.join(staging, 'release-assets.json'), JSON.stringify(report, null, 2) + '\n');
await mkdir(path.dirname(destination), { recursive: true });
// Next gets an immutable public directory as well as immutable server output.
await mkdir(path.join(staging, 'runtime'), { recursive: true });
await cp('public', path.join(staging, 'runtime/public'), { recursive: true });
await mkdir(path.join(staging, 'runtime/release'), { recursive: true });
for (const name of ['start.mjs', 'static-handler.mjs']) await cp(path.join('scripts/release', name), path.join(staging, 'runtime/release', name));
const builtConfig = JSON.parse(await readFile(path.join(staging, 'required-server-files.json'), 'utf8')).config;
for (const name of ['configOrigin', 'configFile', 'configFileName']) delete builtConfig[name];
builtConfig.distDir = '..';
delete builtConfig.experimental.trustHostHeader;
delete builtConfig.experimental.isExperimentalCompile;
await writeFile(path.join(staging, 'runtime/next.config.mjs'), 'const config = ' + JSON.stringify(builtConfig) + ';\nif (typeof config.htmlLimitedBots === \"string\") config.htmlLimitedBots = new RegExp(config.htmlLimitedBots);\nexport default config;\n');
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  try { await symlink(await realpath(name), path.join(staging, 'runtime', name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
// Bundled server code resolves external packages from its output directory.
await symlink(await realpath('node_modules'), path.join(staging, 'node_modules'), 'dir');
await rename(staging, destination);
console.log(JSON.stringify({ destination, ...report }, null, 2));
console.log('Prepared only. No symlink, service, worker or database was changed.');
