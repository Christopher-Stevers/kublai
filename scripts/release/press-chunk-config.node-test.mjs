import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Evaluate only the existing webpack callback AST. Do not load next.config's
// environment/auth imports, application modules, Next or a compiler here.
const text = await readFile(new URL('../../next.config.js', import.meta.url), 'utf8');
const source = ts.createSourceFile('next.config.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const config = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === 'config'));
const declaration = config?.declarationList.declarations.find(item => item.name.getText(source) === 'config');
assert.ok(declaration && ts.isObjectLiteralExpression(declaration.initializer));
const method = declaration.initializer.properties.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'webpack');
assert.ok(method);
const webpack = vm.runInNewContext(`({${method.getText(source)}}).webpack`, {
  process: { env: {} }, ForemanBundleStats: class {},
});
function fixture() {
  const framework = { name: 'framework', test: () => false, priority: 40, enforce: true };
  const lib = { test: () => false, priority: 30, reuseExistingChunk: true };
  return { context: '/fixed/builder', plugins: [], optimization: {
    moduleIds: 'deterministic', chunkIds: 'deterministic',
    runtimeChunk: { name: 'webpack' },
    splitChunks: { chunks: 'next-original-filter', maxInitialRequests: 25, minSize: 20000, cacheGroups: { framework, lib } },
  } };
}
test('adds only one exact app-pages-browser resource group and preserves all existing Next identities/options', () => {
  const config = fixture(), { framework, lib } = config.optimization.splitChunks.cacheGroups;
  const optimization = config.optimization, split = optimization.splitChunks;
  assert.equal(webpack(config, { dev: false, isServer: false }), config);
  assert.equal(config.optimization, optimization); assert.equal(optimization.splitChunks, split);
  assert.equal(split.cacheGroups.framework, framework); assert.equal(split.cacheGroups.lib, lib);
  assert.deepEqual(Object.keys(split.cacheGroups).sort(), ['foremanPress', 'framework', 'lib']);
  assert.equal(split.chunks, 'next-original-filter'); assert.equal(split.maxInitialRequests, 25); assert.equal(split.minSize, 20000);
  assert.equal(optimization.moduleIds, 'deterministic'); assert.equal(optimization.chunkIds, 'deterministic');
  assert.deepEqual(optimization.runtimeChunk, { name: 'webpack' });
  const group = split.cacheGroups.foremanPress;
  assert.equal(group.name, 'app-press-browser'); assert.equal(group.layer, 'app-pages-browser');
  assert.equal(group.minChunks, 2); assert.equal(group.enforce, true); assert.equal(group.reuseExistingChunk, true); assert.equal(group.priority, 20);
  const module = (name, layer = 'app-pages-browser') => ({ layer, nameForCondition: () => name });
  assert.equal(group.test(module('/fixed/builder/src/hooks/use-press.ts')), true);
  for (const value of [
    module('/fixed/builder/src/components/ui/button.tsx'), module('/other/src/hooks/use-press.ts'),
    module('/fixed/builder/src/hooks/use-press.ts.backup'), module('/fixed/builder/src/hooks/use-press.ts', 'rsc'),
    { layer: 'app-pages-browser' },
  ]) assert.equal(group.test(value), false);
});
test('normalizes only path separators and leaves dev/server configuration unchanged', () => {
  const config = fixture(); config.context = 'C:\\fixed\\builder';
  webpack(config, { dev: false, isServer: false });
  assert.equal(config.optimization.splitChunks.cacheGroups.foremanPress.test({ layer: 'app-pages-browser', nameForCondition: () => 'C:\\fixed\\builder\\src\\hooks\\use-press.ts' }), true);
  for (const mode of [{ dev: true, isServer: false }, { dev: false, isServer: true }]) {
    const untouched = fixture(), before = JSON.stringify(untouched);
    webpack(untouched, mode); assert.equal(JSON.stringify(untouched), before);
  }
});
test('unexpected pinned configuration fails without replacing framework/lib or adding a broad group', () => {
  const config = fixture(); delete config.optimization.splitChunks.cacheGroups.lib;
  assert.throws(() => webpack(config, { dev: false, isServer: false }), /Review the pinned Next/);
  assert.deepEqual(Object.keys(config.optimization.splitChunks.cacheGroups), ['framework']);
});

test('disabled, null and empty default groups cannot silently enable the experiment', () => {
  for (const name of ['framework', 'lib']) for (const value of [false, null, undefined, {}]) {
    const config = fixture(); config.optimization.splitChunks.cacheGroups[name] = value;
    assert.throws(() => webpack(config, { dev: false, isServer: false }), /Review the pinned Next/);
    assert.equal('foremanPress' in config.optimization.splitChunks.cacheGroups, false);
  }
});
