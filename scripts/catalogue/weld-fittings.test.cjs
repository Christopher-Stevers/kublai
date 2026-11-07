const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { validate, nominal } = require("../import-weld-fittings.cjs");
const manifest = JSON.parse(
  fs.readFileSync("data/catalogue/weld-fittings.json", "utf8"),
);
const article = (/** @type {string} */ sku) => manifest.rows.find((/** @type {any} */ r) => r.sku === sku);

test("all published articles and image files pass the independent import checks", () => {
  assert.equal(validate().articles, 2268);
});

test("source edge cases retain engineering distinctions and connection sizes", () => {
  // ASC writes mixed fractions without the separator: 11/4 means 1-1/4.
  assert.equal(article("0362001406").sizeNominal, 1.25);
  assert.equal(article("0362001406").sizeLabel, '1 1/4"');
  // Weldbend alphanumeric part numbers distinguish S160 and XXS.
  assert.equal(article("23401C020000").wall, "Schedule 160");
  assert.equal(article("23402A020000").wall, "XXS Wall");
  // A two-size manufacturer tee notation identifies equal runs and a branch.
  assert.deepEqual(article("04606-192160").connectionSizes, [
    '12"',
    '12"',
    '10"',
  ]);
  assert.equal(article("04606-192160").grade, "316/316L");
  assert.equal(article("04606-192160").wall, "Schedule 40S");
  assert.equal(article("01401-08").wall, "Schedule 10S");
  assert.equal(nominal('2 1/2"'), 2.5);
  // Unexpanded manufacturer status code stays provenance, never inferred stock.
  assert.equal(
    article("04413-4816").manufacturerNote,
    "SUD (manufacturer catalogue code)",
  );
  assert(!article("04413-4816").availability);
});

test("rejects duplicate specifications even with a different manufacturer article number", () => {
  const copy = structuredClone(manifest);
  copy.rows[1].displayName = copy.rows[0].displayName;
  copy.rows[1].description = copy.rows[0].description;
  assert.throws(() => validate(copy), /Duplicate specification/);
});

test("rejects lost SKU aliases and manufacturer text in descriptions", () => {
  const copy = structuredClone(manifest);
  copy.rows[0].aliases = copy.rows[0].aliases.filter(
    (/** @type {any} */ a) => a !== copy.rows[0].sku,
  );
  assert.throws(() => validate(copy));
  const other = structuredClone(manifest);
  other.rows[0].description = "Weldbend " + other.rows[0].description;
  other.rows[0].displayName = other.rows[0].description;
  assert.throws(() => validate(other));
});

test("rejects missing grade, changed connection size, mixed weld category and pricing", () => {
  for (const mutate of [
    (/** @type {any} */ d) => {
      d.rows.find((/** @type {any} */ r) => r.grade).grade = "304";
    },
    (/** @type {any} */ d) => {
      d.rows[0].sizeNominal = 5;
    },
    (/** @type {any} */ d) => {
      d.rows[0].category = "Socket-Weld Fittings";
    },
    (/** @type {any} */ d) => {
      d.rows[0].price = 99;
    },
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => validate(copy));
  }
});

test("rejected manufacturer thumbnails are replaced with documented correct-family images", () => {
  assert(
    manifest.images["asc:2155"].sourcePage.includes("2175-half-couplings"),
  );
  assert(
    manifest.images["asc:2128"].sourcePage.includes("2126-socket-weld-union"),
  );
  const typeC = manifest.images["merit:bd0e69844fe0b419f603"];
  assert(typeC.sourceUrl.endsWith("Stainless-Steel-Catalog.pdf#page=79"));
  assert(
    typeC.notes.includes("Type C") &&
      typeC.notes.includes("engineering drawing"),
  );
});
