// @ts-nocheck -- standalone data-import tests.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { validate } = require("../import-weld-flanges.cjs");
const { parseFlange } = require("./flange-source.cjs");
const manifest = JSON.parse(
  fs.readFileSync("data/catalogue/weld-flanges.json", "utf8"),
);
test("all imported specifications are unique and carry source and image provenance", () => {
  assert.equal(validate().articles, 671);
  assert.deepEqual(validate().counts, {
    "Weld-Neck": 339,
    "Slip-On": 229,
    Blind: 103,
  });
  assert(!manifest.rows.some((r) => r.sku === "10562D003000"));
  assert.equal(manifest.excluded[0].sku, "10562D003000");
});
test("retains flange size versus reduced bore and preserves bore/facing distinctions", () => {
  const reduced = parseFlange(
    "10511A011002",
    '1-1/4" X 1/2" Class 150 Red SLIP-ON RF',
    32,
  );
  assert.equal(reduced.sizeNominal, 1.25);
  assert.deepEqual(reduced.connectionSizes, ['1 1/4"', '1/2"']);
  assert(reduced.displayName.includes("Reducing Slip-On"));
  const rf = manifest.rows.find((r) => r.sku === "10562C003000");
  assert.equal(rf.bore, "Schedule 160 Bore");
  assert.equal(rf.facing, "Raised Face");
  const rtj = manifest.rows.find((r) => r.sku === "10583C022000");
  assert.equal(rtj.facing, "Ring Type Joint");
  assert.equal(rtj.bore, null);
  assert(rtj.aliases.includes("10583C022000"));
  assert(!rtj.displayName.includes("10583C022000"));
});
test("rejects unsupported source formats and bore on blind flanges", () => {
  assert.throws(() =>
    parseFlange("105630002000", '1/2" Class 600 BLIND Std RF', 940),
  );
  assert.throws(() =>
    parseFlange("105120002000", '1/2" Class 150 WELD NECK RF', 1),
  );
  assert.throws(() =>
    parseFlange("105110002000", '1/2" Class 150 SLIP-ON UNKNOWN', 1),
  );
});
test("rejects changed size, missing aliases, unexpected pricing, and duplicate specifications", () => {
  for (const mutate of [
    (r) => (r[0].sizeNominal = 4),
    (r) => (r[0].aliases = []),
    (r) => (r[0].price = 25),
    (r) => (r[1] = structuredClone(r[0])),
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy.rows);
    assert.throws(() => validate(copy));
  }
});
