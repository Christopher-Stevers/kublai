const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { validate } = require('../import-process-catalogue.cjs');
const manifest = JSON.parse(fs.readFileSync('data/catalogue/process-pp-pvdf.json', 'utf8'));
const rows = new Map(manifest.rows.map((/** @type {any} */ r) => [r.sku, r]));

test('PP/PVDF catalogue contains distinct exact articles with valid genuine photo assets', () => {
  const result = validate(manifest);
  assert.equal(result.articles, 1186);
  assert.equal(result.uniqueImages, 79);
});

test('actual product family controls purity and preserves polymer grade', () => {
  const standard = rows.get('167480710');
  assert.equal(standard.model, 'PROGEF Standard');
  assert(!standard.displayName.includes('High Purity'));
  assert.equal(standard.grade, 'PP-H');
  const plus = rows.get('167481727');
  assert.equal(plus.model, 'PROGEF Plus');
  assert(plus.displayName.includes('High Purity'));
  assert.equal(plus.sourceRow, 2152, 'An earlier conflicting regional row must not suppress the valid Plus row');
  assert(rows.get('168480151').displayName.includes('Natural PP-R'));
  const pvdf = rows.get('735903190');
  assert.equal(pvdf.material, 'PVDF');
  assert.equal(pvdf.grade, 'PVDF-HP');
  assert.equal(pvdf.sdr, 'SDR33-21');
});

test('real metric OD and inch thread sizes stay distinct, including gender', () => {
  for (const [sku, gender] of [['727914656', 'Male'], ['727914356', 'Female']]) {
    const r = rows.get(sku);
    assert.equal(r.sizeNominal, 20);
    assert.equal(r.sizeUnit, 'mm');
    assert.deepEqual(r.connectionSizes, ['20 mm', '1/2"']);
    assert.equal(r.threadGender, gender);
    assert.equal(r.threadStandard, 'NPT');
    assert(r.displayName.includes(`${gender} NPT`));
  }
  const instrument = rows.get('735918849');
  assert.deepEqual(instrument.connectionSizes, ['355 mm', '1/2"']);
  assert.equal(instrument.threadStandard, 'NPT');
  assert.equal(instrument.threadGender, undefined, 'No gender should be inferred when manufacturer data does not state it');
});

test('verified reducing-bush diameter convention preserves both ends', () => {
  const r = rows.get('735910107');
  assert.equal(r.fittingType, 'Reducing bush');
  assert.deepEqual(r.connectionSizes, ['32 mm', '25 mm']);
  assert.equal(r.sizeNominal, 32);
  assert.equal(r.sourceRow, 1180);
});

test('published PVDF pipe packaging and mixed flange/clamp ends remain visible', () => {
  const pipes = manifest.rows.filter((/** @type {any} */ r) => r.material === 'PVDF' && r.fittingType === 'Pipe');
  assert.equal(pipes.length, 30);
  assert(pipes.every((/** @type {any} */ r) => r.length === '5 m' && r.displayName.endsWith('x 5 m')));
  for (const sku of ['735798857', '735790257']) {
    const r = rows.get(sku);
    assert.deepEqual(r.connectionSizes, ['25 mm', '3/4"']);
    assert.equal(r.threadStandard, undefined, 'ANSI flange size is not an inch thread');
  }
  assert.deepEqual(rows.get('735318101').connectionSizes, ['20 mm', '1"']);
  assert.deepEqual(rows.get('735318505').connectionSizes, ['50 mm', '2"']);
  assert.deepEqual(rows.get('735318606').connectionSizes, ['63 mm', '2 1/2"']);
});

test('engineering graphics are excluded and genuine alternate union photo retained', () => {
  const excluded = ['wJrNw0QZA', 'kvWJz2dxM', '6BERwE7J2', 'qD3q9OM0m', '2yv4kvKJq', 'Gobg8banA', 'qy9AO916z', 'Axl2Llyzr', 'wjwKawaYk'];
  assert(excluded.every((id) => !manifest.images[`gf:${id}`]));
  assert.equal(rows.get('727518112').imageKey, 'gf:09jVJmN1L');
  assert(manifest.exclusions.some((/** @type {any} */ r) => r.reason.includes('drawing, cutaway')));
});
