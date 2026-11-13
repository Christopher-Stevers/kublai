const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { validate, attributes } = require('../import-process-catalogue.cjs');
const manifest = JSON.parse(fs.readFileSync('data/catalogue/process-instrumentation.json', 'utf8'));
const bySku = new Map(manifest.rows.map((/** @type {any} */ row) => [row.sku, row]));

test('instrument source articles and genuine image assets pass import validation', () => {
  const checked = validate(manifest);
  assert.equal(checked.articles, 41);
  assert.equal(checked.uniqueImages, 5);
  for (const row of manifest.rows) assert.equal(row.description, row.displayName);
});

test('measurement ranges and dial diameters cannot become pipe sizes or pressure classes', () => {
  const gauge = bySku.get('PGS-25L-160');
  assert.equal(gauge.sizeNominal, 0.25);
  assert.equal(gauge.pressureClass, null);
  assert.equal(gauge.attributes['Measurement range'], '0–160 psi');
  assert.equal(gauge.attributes['Dial diameter'], '2 1/2"');
  const flow = bySku.get('VFC-142');
  assert.equal(flow.sizeNominal, 1);
  assert.equal(flow.pressureClass, null);
  assert.equal(flow.attributes['Calibrated medium'], 'Water');
  assert.equal(flow.attributes['Flow measurement range'], '1–10 GPM');
  assert.equal(flow.attributes['Pressure-temperature limit'], '100 psig at 120°F / 6.9 bar at 48°C');
  assert.doesNotThrow(() => attributes(flow));
});

test('fabricated wells retain NPSM instrument threads, unlike machined NPT wells', () => {
  const fabricated = bySku.get('TE-TNS-N063N-00');
  const machined = bySku.get('TE-TNS-N064N-14');
  assert.equal(fabricated.connectionType, 'MNPT x FNPSM');
  assert.equal(fabricated.attributes['Instrument connection'], '1/2" FNPSM');
  assert.equal(machined.connectionType, 'MNPT x FNPT');
  assert.equal(machined.attributes['Instrument connection'], '1/4" FNPT');
  assert.notEqual(fabricated.imageKey, machined.imageKey);
  assert.equal(fabricated.attributes['Maximum pressure'], '140 psi');
  assert.equal(machined.attributes['Maximum pressure'], '3700 psi');
});

test('thermometers preserve Fahrenheit-only and back-mount variants exactly', () => {
  const fahrenheitOnly = bySku.get('BTB22551');
  assert.equal(fahrenheitOnly.attributes['Scale type'], 'Fahrenheit only');
  assert.equal(fahrenheitOnly.attributes['Measurement range Celsius'], undefined);
  assert.equal(fahrenheitOnly.sizeNominal, 0.25);
  const dual = bySku.get('BTB34010D');
  assert.equal(dual.attributes['Measurement range Celsius'], '-20–100°C');
  assert.equal(dual.sizeNominal, 0.5);
  assert(manifest.rows.filter((/** @type {any} */ r) => r.category === 'Thermometers').every((/** @type {any} */ r) => r.attributes.Mounting === 'Back connection'));
});
