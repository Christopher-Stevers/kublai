#!/usr/bin/env node
// @ts-nocheck -- validated standalone data import; no application/schema changes.
require("dotenv/config");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");
const sourceFile = "data/catalogue/weld-fittings.json";
const source = "weld-fittings-20261104";
const apply = process.argv.includes("--apply");
const hash = (v) => createHash("sha256").update(v).digest("hex");
const data = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
const expectedCounts = {
  "carbon-butt-weld": 754,
  "carbon-socket-weld": 434,
  "stainless-butt-weld": 827,
  "stainless-socket-weld": 253,
};
const stable = (v) => {
  const b = createHash("sha256").update(v).digest().subarray(0, 16);
  b[6] = (b[6] & 15) | 80;
  b[8] = (b[8] & 63) | 128;
  const s = b.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
function nominal(label) {
  return label
    .replaceAll('"', "")
    .split(" ")
    .reduce((n, p) => {
      const [a, b] = p.split("/").map(Number);
      return n + a / (b || 1);
    }, 0);
}
function validate(candidate = data) {
  const counts = {},
    identities = new Set(),
    names = new Set();
  for (const r of candidate.rows) {
    const key = r.manufacturer + ":" + r.sku;
    assert(!identities.has(key), "Duplicate manufacturer article " + key);
    identities.add(key);
    assert(
      !names.has(r.displayName.toLowerCase()),
      "Duplicate specification " + r.displayName,
    );
    names.add(r.displayName.toLowerCase());
    counts[r.family] = (counts[r.family] || 0) + 1;
    assert(
      r.description === r.displayName &&
        r.category === r.connectionType + " Fittings",
    );
    assert(!/Weldbend|Anvil|ASC|Merit Brass/i.test(r.description));
    assert(!r.description.includes(r.sku), "Manufacturer SKU in description");
    assert(
      r.description.length <= 255 && r.aliases.every((a) => a.length <= 255),
    );
    assert(r.aliases.includes(r.sku) && r.aliases.includes(r.manufacturer));
    assert(r.aliases.includes(`${r.manufacturer} ${r.sku}`));
    assert(r.connectionSizes.join(" x ") === r.sizeLabel);
    assert(Math.max(...r.connectionSizes.map(nominal)) === r.sizeNominal);
    assert(r.sizeNominal >= 0.125 && r.sizeNominal <= 24);
    assert(
      r.description.startsWith(r.sizeLabel + " ") &&
        r.description.includes(r.fittingType),
    );
    assert(!Object.keys(r).some((k) => /price|stock|availability/i.test(k)));
    if (r.family.startsWith("stainless-")) {
      assert(
        r.manufacturer === "Merit Brass" && r.material === "Stainless steel",
      );
      assert(
        ["304/304L", "316/316L"].includes(r.grade) &&
          r.description.includes(r.grade),
      );
      assert(
        r.sourceUrl.startsWith(
          "https://order.meritbrass.com/Catalog/ProductDetail?Product=",
        ),
      );
    } else {
      assert(r.material === "Carbon Steel" && !r.grade);
      assert(r.sourceRow > 1 && r.sourceSheet);
      if (r.family === "carbon-butt-weld") {
        assert(r.manufacturer === "Weldbend" && /^234[0-9A-Z]{9}$/.test(r.sku));
        assert(r.sourceUrl === "https://www.weldbend.com/PriceSheet_1126.xlsx");
      } else {
        assert(r.manufacturer === "Anvil / ASC" && /^\d{10}$/.test(r.sku));
        assert(
          r.sourceUrl ===
            "https://s3.us-east-1.amazonaws.com/ue1.asc-es.com/price-sheets/excel/CSF-6.26-website.xls",
        );
        assert(/^\d{12}$/.test(r.upc));
      }
    }
    if (r.family.endsWith("butt-weld")) {
      assert(r.connectionType === "Butt-Weld" && r.wall && !r.pressureClass);
      assert(
        [
          "STD Wall",
          "XS Wall",
          "XXS Wall",
          "Schedule 160",
          "Schedule 10S",
          "Schedule 40S",
        ].includes(r.wall),
      );
      assert(r.description.includes(r.wall));
    } else {
      assert(
        r.connectionType === "Socket-Weld" &&
          !r.wall &&
          ["3000", "6000"].includes(r.pressureClass),
      );
      assert(r.description.includes("Class " + r.pressureClass));
    }
    assert(candidate.images[r.imageKey], "Missing image " + r.imageKey);
  }
  assert.deepEqual(counts, expectedCounts);
  assert.deepEqual(candidate.counts, expectedCounts);
  for (const im of Object.values(candidate.images)) {
    assert(
      path
        .resolve(im.path)
        .startsWith(path.resolve("public/images/catalog/uploads") + path.sep),
    );
    assert(hash(fs.readFileSync(im.path)) === im.sha256);
    assert(fs.statSync(im.path).size === im.byteSize);
    assert(im.url === `/api/catalogue/images/part-${im.sha256}.webp`);
    assert(im.width === im.height && im.width > 100);
    assert(
      /^https:\/\/(www\.weldbend\.com|www\.meritbrass\.com|s3\.us-east-1\.amazonaws\.com|mbcecomstore\.blob\.core\.windows\.net)\//.test(
        im.sourceUrl,
      ),
    );
  }
  return {
    articles: candidate.rows.length,
    counts,
    imageMappings: Object.keys(candidate.images).length,
    uniqueImages: new Set(Object.values(candidate.images).map((i) => i.sha256))
      .size,
    engineeringDrawings: new Set(
      Object.values(candidate.images)
        .filter((i) => i.imageKind === "engineering-drawing")
        .map((i) => i.sha256),
    ).size,
  };
}
function attributes(r) {
  return {
    manufacturer: r.manufacturer,
    manufacturer_part_number: r.sku,
    manufacturer_source: r.sourceUrl,
    manufacturer_description: r.manufacturerDescription,
    source_import: source,
    connection_type: r.connectionType,
    connections: JSON.stringify(r.connectionSizes),
    fitting_type: r.fittingType,
    ...(r.wall
      ? { wall_designation: r.wall }
      : { pressure_class: r.pressureClass }),
    ...(r.grade ? { stainless_grade: r.grade } : {}),
    ...(r.model ? { manufacturer_model: r.model, upc: r.upc } : {}),
    ...(r.standard ? { manufacturer_standard: r.standard } : {}),
    ...(r.sourceRow
      ? {
          manufacturer_source_row: String(r.sourceRow),
          manufacturer_source_sheet: r.sourceSheet,
        }
      : {}),
    ...(r.listingUrl ? { manufacturer_listing: r.listingUrl } : {}),
    ...(r.manufacturerNote ? { manufacturer_note: r.manufacturerNote } : {}),
  };
}
async function batchInsert(tx, table, rows) {
  for (let i = 0; i < rows.length; i += 1000)
    await tx`insert into ${tx(table)} ${tx(rows.slice(i, i + 1000))}`;
}
async function main() {
  const validation = validate();
  if (process.argv.includes("--validate-only")) {
    console.log(JSON.stringify(validation, null, 2));
    return;
  }
  assert(process.env.DATABASE_URL, "DATABASE_URL required");
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    connect_timeout: 10,
  });
  try {
    const result = await sql.begin(apply ? "" : "read only", async (tx) => {
      const users =
        await tx`select "organizationId" from kublai_user where lower(email)=lower(${process.env.WELD_FITTINGS_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com"})`;
      assert(
        users.length === 1 && users[0].organizationId,
        "Expected exactly one organization account",
      );
      const org = users[0].organizationId;
      if (apply)
        await tx`select pg_advisory_xact_lock(hashtext(${source + org}))`;
      const prepared = data.rows.map((r) => ({
        r,
        id: stable(source + org + r.manufacturer + ":" + r.sku),
      }));
      const existing =
        await tx`select p.id,p."displayName",m.name material,c.name category from kublai_part_definition p left join kublai_material m on m.id=p."materialId" left join kublai_category c on c.id=p."categoryId" where p."organizationId"=${org}`;
      const ids = new Set(existing.map((p) => p.id));
      const pending = prepared.filter((p) => !ids.has(p.id));
      const articleIds =
        await tx`select p.id, max(a."valueText") filter(where a.key='manufacturer') manufacturer,max(a."valueText") filter(where a.key='manufacturer_part_number') sku from kublai_part_definition p join kublai_part_attribute a on a."partDefinitionId"=p.id where p."organizationId"=${org} and a.key in ('manufacturer','manufacturer_part_number') group by p.id`;
      for (const p of pending) {
        assert(
          !existing.some(
            (e) =>
              e.displayName.toLowerCase() === p.r.displayName.toLowerCase(),
          ),
          "Existing matching name requires review: " + p.r.displayName,
        );
        assert(
          !articleIds.some(
            (e) => e.manufacturer === p.r.manufacturer && e.sku === p.r.sku,
          ),
          "Existing matching manufacturer article: " + p.r.sku,
        );
      }
      const legacyWeldFittings = existing.filter(
        (e) =>
          e.category === "Fitting" &&
          ["Carbon Steel", "Stainless steel"].includes(e.material) &&
          /weld|stub end/i.test(e.displayName) &&
          !prepared.some((p) => p.id === e.id),
      );
      const [revisionBefore] =
        await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
      const summary = {
        mode: apply ? "apply" : "dry-run",
        ...validation,
        wouldCreate: pending.length,
        created: 0,
        alreadyPresent: prepared.length - pending.length,
        legacyWeldFittingsRetained: legacyWeldFittings.length,
      };
      if (!apply)
        return {
          ...summary,
          legacyWeldFittings: legacyWeldFittings.map((p) => p.displayName),
          revision: revisionBefore?.revision,
        };
      let backup;
      if (pending.length) {
        fs.mkdirSync("state-backups", { recursive: true });
        backup = `state-backups/${source}-${Date.now()}.json`;
        fs.writeFileSync(
          backup,
          JSON.stringify(
            {
              org,
              plannedNewIds: pending.map((p) => p.id),
              legacyWeldFittings,
              sourceHash: hash(fs.readFileSync(sourceFile)),
              revisionBefore,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
        const named = async (table, name, extra = {}) => {
          const matches =
            await tx`select id from ${tx(table)} where "organizationId"=${org} and lower(name)=lower(${name})`;
          assert(matches.length <= 1, "Ambiguous facet " + name);
          if (matches[0]) return matches[0].id;
          const [item] =
            await tx`insert into ${tx(table)} ${tx({ id: randomUUID(), organizationId: org, name, ...extra })} returning id`;
          return item.id;
        };
        const catalogId = await named("kublai_catalog", "Plumbing", {
          kind: "materials",
          sortOrder: 0,
          createdAt: new Date(),
        });
        const categories = new Map();
        for (const name of new Set(data.rows.map((r) => r.category)))
          categories.set(
            name,
            await named("kublai_category", name, { sortOrder: 1 }),
          );
        const materials = new Map();
        for (const name of new Set(data.rows.map((r) => r.material)))
          materials.set(
            name,
            await named("kublai_material", name, {
              groupPath: tx.json([]),
              createdAt: new Date(),
            }),
          );
        const [unit] = await tx`select id from kublai_unit where code='in'`;
        assert(unit, "Missing inch unit");
        const sizes = new Map(
          (
            await tx`select id,nominal from kublai_size where "organizationId"=${org} and "unitId"=${unit.id}`
          ).map((s) => [Number(s.nominal), s.id]),
        );
        for (const n of new Set(data.rows.map((r) => r.sizeNominal)))
          if (!sizes.has(n)) {
            const [s] =
              await tx`insert into kublai_size ${tx({ id: randomUUID(), organizationId: org, nominal: String(n), unitId: unit.id, createdAt: new Date() })} returning id`;
            sizes.set(n, s.id);
          }
        const assets = new Map();
        for (const [key, im] of Object.entries(data.images)) {
          let [asset] =
            await tx`select id from kublai_photo_asset where "organizationId"=${org} and url=${im.url}`;
          if (!asset)
            [asset] =
              await tx`insert into kublai_photo_asset ${tx({ id: randomUUID(), organizationId: org, storageKey: path.basename(im.path), url: im.url, originalFilename: `weld-fitting-${key.replaceAll(":", "-")}.webp`, contentType: "image/webp", byteSize: im.byteSize, checksum: im.sha256, sourceUrl: im.sourceUrl, notes: im.notes, createdAt: new Date(), updatedAt: new Date() })} returning id`;
          assets.set(key, asset.id);
        }
        await batchInsert(
          tx,
          "kublai_part_definition",
          pending.map(({ id, r }) => ({
            id,
            organizationId: org,
            catalogId,
            categoryId: categories.get(r.category),
            materialId: materials.get(r.material),
            sizeId: sizes.get(r.sizeNominal),
            displayName: r.displayName,
            description: r.description,
            sizeLabel: r.sizeLabel,
            imageUrl: data.images[r.imageKey].url,
            imageAssetId: assets.get(r.imageKey),
            isActive: true,
            createdAt: new Date(),
          })),
        );
        await batchInsert(
          tx,
          "kublai_part_attribute",
          pending.flatMap(({ id, r }) =>
            Object.entries(attributes(r)).map(([key, valueText]) => ({
              id: randomUUID(),
              partDefinitionId: id,
              key,
              valueText,
            })),
          ),
        );
        await batchInsert(
          tx,
          "kublai_part_synonym",
          pending.flatMap(({ id, r }) =>
            [...new Set(r.aliases)].map((synonym) => ({
              id: randomUUID(),
              partDefinitionId: id,
              synonym,
            })),
          ),
        );
      }
      const actual =
        await tx`select p.*,m.name material,c.name category,cat.name catalog,s.nominal from kublai_part_definition p join kublai_material m on m.id=p."materialId" join kublai_category c on c.id=p."categoryId" join kublai_catalog cat on cat.id=p."catalogId" join kublai_size s on s.id=p."sizeId" where p."organizationId"=${org} and p.id in ${tx(prepared.map((p) => p.id))}`;
      const actualAttrs =
        await tx`select "partDefinitionId",key,"valueText" from kublai_part_attribute where "partDefinitionId" in ${tx(prepared.map((p) => p.id))}`;
      const actualAliases =
        await tx`select "partDefinitionId",synonym from kublai_part_synonym where "partDefinitionId" in ${tx(prepared.map((p) => p.id))}`;
      const actualById = new Map(actual.map((p) => [p.id, p]));
      assert(actual.length === data.rows.length, "Part count mismatch");
      for (const { id, r } of prepared) {
        const p = actualById.get(id);
        for (const key of [
          "displayName",
          "description",
          "sizeLabel",
          "material",
          "category",
        ])
          assert(p[key] === r[key], `${r.sku}: ${key} mismatch`);
        assert(
          p.catalog === "Plumbing" &&
            Number(p.nominal) === r.sizeNominal &&
            p.isActive &&
            p.imageAssetId &&
            p.imageUrl === data.images[r.imageKey].url,
        );
        const attrs = Object.fromEntries(
          actualAttrs
            .filter((a) => a.partDefinitionId === id)
            .map((a) => [a.key, a.valueText]),
        );
        for (const [k, v] of Object.entries(attributes(r)))
          assert(attrs[k] === v, `${r.sku}: ${k} mismatch`);
        const aliases = new Set(
          actualAliases
            .filter((a) => a.partDefinitionId === id)
            .map((a) => a.synonym),
        );
        assert(
          r.aliases.every((a) => aliases.has(a)),
          `${r.sku}: aliases missing`,
        );
      }
      const [listingCheck] =
        await tx`select count(*)::int total from kublai_supplier_part where "partDefinitionId" in ${tx(prepared.map((p) => p.id))}`;
      assert(
        listingCheck.total === 0,
        "Unexpected supplier pricing/listing created",
      );
      const [revisionAfter] =
        await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
      assert(
        pending.length
          ? Number(revisionAfter?.revision) > Number(revisionBefore?.revision)
          : revisionAfter?.revision === revisionBefore?.revision,
        "Unexpected catalogue revision",
      );
      return {
        ...summary,
        created: pending.length,
        verified: actual.length,
        aliases: actualAliases.length,
        attributes: actualAttrs.length,
        revisionBefore: revisionBefore?.revision,
        revisionAfter: revisionAfter?.revision,
        backup,
      };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sql.end();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { validate, attributes, nominal, stable };
