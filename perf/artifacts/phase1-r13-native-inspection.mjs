// Read-only emitted-code check. Evaluates only the extracted metadata resolver,
// never an app bundle, connection, listener, server or database module.
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const [build] = process.argv.slice(2);
if (!build) throw Error('Need canonical build directory');
const file = path.join(build, 'server/chunks/4735.js');
const code = await fs.readFile(file, 'utf8');
const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const candidates = [];
function visit(node) {
  if (ts.isFunctionExpression(node)) {
    const text = node.getText(ast);
    if (text.length < 1500 && text.includes('Reflect.apply(createRequire') && text.includes('.resolve("postgres")')) candidates.push(text);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (candidates.length !== 1) throw Error('Expected one exact emitted resolver');
const text = candidates[0];
const context = { f: () => path, d: { readFileSync }, process: { cwd: () => path.resolve(build, 'runtime') } };
const missingBindingResult = vm.runInNewContext(`(${text})()`, context, { timeout: 1000 });
const explicitNativeBindingControl = vm.runInNewContext(`(${text})()`, { ...context, createRequire }, { timeout: 1000 });
const occurrences = [...code.matchAll(/\bcreateRequire\b/g)].length;
const emittedCopies = [];
async function scan(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { await scan(file); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const source = await fs.readFile(file, 'utf8');
    if (source.includes('Reflect.apply(createRequire') && source.includes('.resolve("postgres")'))
      emittedCopies.push({ file: path.relative(build, file), createRequireOccurrences: [...source.matchAll(/\bcreateRequire\b/g)].length });
  }
}
await scan(path.join(build, 'server'));
console.log(JSON.stringify({
  sourceBuild: (await fs.readFile(path.join(build, 'BUILD_ID'), 'utf8')).trim(),
  method: 'Exact emitted function inspected and evaluated alone with native path/fs and runtime cwd; no app module or database code executed. Explicit binding is diagnostic control only, not a patch to the candidate.',
  emittedFile: 'server/chunks/4735.js',
  resolverSha256: createHash('sha256').update(text).digest('hex'),
  createRequireOccurrencesInWholeChunk: occurrences,
  emittedCopies,
  indirectNativeCallRetained: text.includes('Reflect.apply(createRequire'),
  runtimeCwdRetained: text.includes('process.cwd()'),
  postgresResolveStringRetained: text.includes('.resolve("postgres")'),
  absolutePathGuardRetained: text.includes('isAbsolute('),
  numericDirnameIntroduced: /dirname\(\d+\)/.test(text),
  missingBindingResult,
  explicitNativeBindingControl,
  passed: false,
  failure: 'createRequire appears only as a free identifier in the emitted CommonJS chunk. It throws inside catch and returns null, so LISTEN readiness fails closed.',
  appRuntimeStarted: false,
  databaseStarted: false,
}, null, 2));
