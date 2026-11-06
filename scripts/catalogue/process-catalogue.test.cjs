// @ts-nocheck -- standalone catalogue import integrity checks, no DB writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sharp = require('sharp');
const { validate, attributes, articleKey, stable } = require('../import-process-catalogue.cjs');
const data = JSON.parse(fs.readFileSync('data/catalogue/process-stainless.json', 'utf8'));
const article = (sku) => data.rows.find(r => r.sku === sku);
const fixture = (row) => ({rows:[structuredClone(row)], images:{[row.imageKey]:data.images[row.imageKey]}});

test('all stainless/process articles validate and original photos decode at recorded dimensions', async () => {
  assert.equal(validate(data).articles, data.rows.length);
  for (const r of data.rows) attributes(r);
  for (const im of Object.values(data.images)) {
    const metadata = await sharp(im.path).metadata();
    assert.equal(metadata.format,'webp');
    assert.equal(metadata.width,im.width);
    assert.equal(metadata.height,im.height);
    assert.ok(im.width>=im.sourceWidth && im.height>=im.sourceHeight);
  }
});

test('manufacturer identity is case insensitive but source variant IDs remain distinct from part numbers', () => {
  assert.equal(stable(articleKey({manufacturer:' Merit Brass ',sku:'i7780'})),stable(articleKey({manufacturer:'merit brass',sku:'I7780'})));
  assert.notEqual(articleKey({sourceVendor:'Vendor',sku:'123',skuKind:'catalogue-variant-id'}),articleKey({sourceVendor:'Vendor',sku:'123'}));
  const d=fixture(article('I77128'));
  d.rows.push({...d.rows[0],sku:d.rows[0].sku.toLowerCase()});
  assert.throws(()=>validate(d),/Duplicate or missing article/);
});

test('source specifications retain nominal pipe size, tube OD, mixed NPT ends and wall/length differences', () => {
  const flange=article('A45180L-12');
  assert.equal(flange.sizeLabel,'3/4"');
  assert.equal(flange.sizeNominal,.75);
  assert.equal(attributes(flange).size_basis,'NPS');
  assert.equal(attributes(flange).schedule,'80');
  const adapter=article('21MP-G100200');
  assert.deepEqual(adapter.connectionSizes,['1"','2"']);
  assert.equal(attributes(adapter)['Connection sizes'],'Tube OD x NPT nominal');
  assert.equal(attributes(adapter)['Tube OD'],'1"');
  assert.equal(attributes(adapter)['NPT size'],'2"');
  const tube=article('A270.083-R400P');
  assert.equal(attributes(tube)['Wall thickness'],'0.083 in');
  assert.equal(attributes(tube).material_grade,'316L');
  assert.equal(attributes(tube).size_basis,'Tube OD');
  assert.equal(attributes(tube)['Length'],'20 ft');
});

test('shared clamp sizes are compatibility ranges, not reducing pipe connections', () => {
  const clamp=article('13MHHM100-150');
  assert.equal(clamp.sizeLabel,'1" / 1 1/2"');
  assert.deepEqual(clamp.compatibleTubeSizes,['1"','1 1/2"']);
  assert.equal(attributes(clamp)['Service pressure at 70 F / 21 C'],'500 psi');
  assert.match(attributes(clamp)['Pressure rating conditions'],/do not apply.*PTFE/);
});

test('metric nominal values and legitimate unsized products survive without inch conversion or invented size', () => {
  const metric=fixture(article('13MHHM200'));
  metric.rows[0].sizeUnit='mm';metric.rows[0].sizeNominal=50;metric.rows[0].sizeLabel='50 mm';metric.rows[0].connectionSizes=['50 mm'];
  validate(metric);
  assert.equal(attributes(metric.rows[0]).size_unit,'mm');
  const unsized=fixture(article('13MHHM200'));
  unsized.rows[0].sizeNominal=null;unsized.rows[0].sizeLabel='';unsized.rows[0].connectionSizes=[];
  validate(unsized);
  assert.deepEqual(JSON.parse(attributes(unsized.rows[0]).connections),[]);
  const invalid=fixture(article('13MHHM200'));
  invalid.rows[0].sizeNominal=0;
  assert.throws(()=>validate(invalid),/Invalid nominal size/);
});

test('conflicting metadata and substituted or nonphotographic assets are rejected', () => {
  const row=structuredClone(article('13MHHM200'));
  row.attributes={manufacturer:'Other maker'};
  assert.throws(()=>attributes(row),/Conflicting attribute/);
  const d=fixture(article('13MHHM200'));
  d.images=structuredClone(d.images);
  d.images[d.rows[0].imageKey].sha256='0'.repeat(64);
  assert.throws(()=>validate(d),/Photo hash mismatch/);
  d.images[d.rows[0].imageKey]=structuredClone(data.images[d.rows[0].imageKey]);
  d.images[d.rows[0].imageKey].imageKind='engineering-drawing';
  assert.throws(()=>validate(d),/Photo required/);
});
