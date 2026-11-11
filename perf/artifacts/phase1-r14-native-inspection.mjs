// Inspect/evaluate only an exact emitted metadata resolver with its actual
// native external modules. Never load an app bundle, LISTEN or database code.
import fs from 'node:fs/promises';
import * as nativeFs from 'node:fs';
import nativeModule from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const [build] = process.argv.slice(2);
if (!build) throw Error('Need canonical build directory');
const file = path.join(build, 'server/chunks/4735.js');
const code = await fs.readFile(file, 'utf8');
if (!/\bd=c\(98995\)/.test(code)) throw Error('Native namespace alias changed; inspect before evaluating');
const bindingFile = path.join(build, 'server/instrumentation.js');
const bindingCode = await fs.readFile(bindingFile, 'utf8');
if (!bindingCode.includes('98995:a=>{a.exports=require("node:module")}')) throw Error('Expected real native external binding');
const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const candidates = [];
function visit(node) {
  if (ts.isFunctionExpression(node)) {
    const text = node.getText(ast);
    if (text.length < 2000 && text.includes('"createRequire"') && text.includes('"resolve"') && text.includes('"postgres"') && text.includes('Reflect.get')) candidates.push(text);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (candidates.length !== 1) throw Error('Expected one exact emitted resolver');
const text = candidates[0];
// d is the actual node:module external, e is native fs, g is webpack's native
// path default getter. No missing factory/global binding is injected.
const metadataVersion = vm.runInNewContext(`(${text})()`, {
  d: nativeModule, e: nativeFs, g: () => path,
  process: { cwd: () => path.resolve(build, 'runtime') },
}, { timeout: 1000 });
const copies = [];
async function scan(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { await scan(file); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const source = await fs.readFile(file, 'utf8');
    if (source.includes('Reflect.get') && source.includes('"createRequire"') && source.includes('"postgres"'))
      copies.push({ file: path.relative(build, file), freeNamedFactoryCall: /Reflect\.apply\(createRequire\b/.test(source) });
  }
}
await scan(path.join(build, 'server'));
const passed = metadataVersion === '3.4.8' && copies.length > 0 && copies.every(copy => !copy.freeNamedFactoryCall);
console.log(JSON.stringify({
  sourceBuild: (await fs.readFile(path.join(build, 'BUILD_ID'), 'utf8')).trim(),
  method: 'Exact emitted resolver evaluated alone with the native external objects to which its emitted bindings resolve; no app module, listener or database evaluated.',
  emittedFile: 'server/chunks/4735.js',
  nativeExternalBindingFile: 'server/instrumentation.js',
  nativeExternalModuleId: 98995,
  namespaceBindingRetained: true,
  namespaceDefaultFallbackRetained: text.includes('Reflect.get(d,"default")??d'),
  resolverSha256: createHash('sha256').update(text).digest('hex'),
  runtimeCwdRetained: text.includes('process.cwd()'),
  numericDirnameIntroduced: /dirname\(\d+\)/.test(text),
  metadataVersion,
  copies,
  passed,
  limitations: ['This is metadata binding/resolution evidence, not an actual LISTEN health or private application functional run.'],
  appRuntimeStarted: false, databaseStarted: false,
}, null, 2));
if (!passed) process.exitCode = 1;
