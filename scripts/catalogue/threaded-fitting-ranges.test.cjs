// @ts-nocheck -- standalone import regression checks.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sharp = require("sharp");
const {
  validate,
  attributes,
  articleKey,
  stable,
} = require("../import-threaded-fitting-ranges.cjs");

const manifests = ["black300", "forged", "stainless"].map((family) =>
  JSON.parse(fs.readFileSync(`data/catalogue/threaded-${family}.json`, "utf8")),
);
const data = {
  rows: manifests.flatMap((m) => m.rows),
  images: Object.assign({}, ...manifests.map((m) => m.images)),
};
function sample(index = 0) {
  const row = structuredClone(data.rows[index]);
  return {
    rows: [row],
    images: { [row.imageKey]: structuredClone(data.images[row.imageKey]) },
  };
}

test("all source articles have unique specifications, complete photos and valid attributes", () => {
  const result = validate(data);
  assert.equal(result.articles, data.rows.length);
  for (const row of data.rows) {
    for (const value of Object.values(attributes(row)))
      assert.equal(typeof value, "string");
    assert.ok(row.sizeLabel.length <= 100);
  }
});

test("every delivered photograph decodes at its recorded dimensions", async () => {
  const seen = new Set();
  for (const im of Object.values(data.images)) {
    if (seen.has(im.sha256)) continue;
    seen.add(im.sha256);
    const metadata = await sharp(im.path).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, im.width);
    assert.equal(metadata.height, im.height);
  }
});

test("a SKU repeated with different letter casing is rejected", () => {
  const d = sample();
  d.rows.push({
    ...d.rows[0],
    manufacturer: d.rows[0].manufacturer.toUpperCase(),
  });
  assert.throws(() => validate(d), /Duplicate or missing article/);
  assert.equal(
    stable(articleKey({ manufacturer: " Merit Brass ", sku: "KP611h-04" })),
    stable(articleKey({ manufacturer: "merit brass", sku: "kp611H-04" })),
  );
});

test("wrong reducing-size label and nominal filter size are rejected", () => {
  const d = sample(
    data.rows.findIndex((r) => new Set(r.connectionSizes).size > 1),
  );
  d.rows[0].sizeLabel = '1/8"';
  assert.throws(() => validate(d), /Size label mismatch/);
  d.rows[0].sizeLabel = d.rows[0].connectionSizes.join(" x ");
  d.rows[0].sizeNominal = 999;
  assert.throws(() => validate(d), /Size nominal mismatch/);
});

test("missing grade, article alias and source location cannot enter the catalogue", () => {
  const grade = sample(
    data.rows.findIndex((r) => r.material === "Stainless steel"),
  );
  delete grade.rows[0].grade;
  assert.throws(() => validate(grade), /Missing stainless grade/);
  const alias = sample();
  alias.rows[0].aliases = [];
  assert.throws(() => validate(alias), /Missing article aliases/);
  const source = sample();
  delete source.rows[0].sourceRow;
  delete source.rows[0].listingUrl;
  assert.throws(() => validate(source), /Missing article source location/);
});

test("photo substitution and source pricing are rejected", () => {
  const photo = sample();
  photo.images[photo.rows[0].imageKey].sha256 = "0".repeat(64);
  assert.throws(() => validate(photo), /Photo hash mismatch/);
  const drawing = sample();
  drawing.images[drawing.rows[0].imageKey].imageKind = "engineering-drawing";
  assert.throws(() => validate(drawing), /Photo required/);
  const pricing = sample();
  pricing.rows[0].listPrice = 12;
  assert.throws(() => validate(pricing), /Unexpected commercial data/);
});

test("stainless pattern, construction and mixed class source notes survive import", () => {
  const patterned = data.rows.find((r) => r.pattern === "MSS Pattern");
  assert.equal(attributes(patterned).fitting_pattern, "MSS Pattern");
  assert.equal(attributes(patterned).construction, "Cast");
  const dual = data.rows.find((r) => r.pressureClass === "3000/1000");
  assert.ok(dual.ratingSourceNote);
  assert.equal(attributes(dual).rating_source_note, dual.ratingSourceNote);
  assert.equal(attributes(dual).pressure_class, "3000/1000");
});
