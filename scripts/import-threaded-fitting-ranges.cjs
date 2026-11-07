#!/usr/bin/env node
// @ts-nocheck -- validated standalone data import; no application/schema changes.
require("dotenv/config");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");
const sourceFiles = [
  "data/catalogue/threaded-black300.json",
  "data/catalogue/threaded-forged.json",
  "data/catalogue/threaded-stainless.json",
];
const source = "threaded-fitting-ranges-20261105";
const apply = process.argv.includes("--apply");
const hash = (v) => createHash("sha256").update(v).digest("hex");
const manifests = sourceFiles.map((file) =>
  JSON.parse(fs.readFileSync(file, "utf8")),
);
const imageKeys = new Map();
for (const manifest of manifests)
  for (const [key, im] of Object.entries(manifest.images)) {
    assert(
      !imageKeys.has(key) || imageKeys.get(key) === im.sha256,
      "Conflicting photo key: " + key,
    );
    imageKeys.set(key, im.sha256);
  }
const data = {
  rows: manifests.flatMap((m) => m.rows),
  images: Object.assign({}, ...manifests.map((m) => m.images)),
};
const normalize = (value) =>
  String(value).trim().replace(/\s+/g, " ").toLowerCase();
const articleKey = (r) => normalize(r.manufacturer) + ":" + normalize(r.sku);
function nominal(label) {
  return label
    .replaceAll('"', "")
    .split(" ")
    .reduce((n, p) => {
      const [a, b] = p.split("/").map(Number);
      return n + a / (b || 1);
    }, 0);
}
const stable = (v) => {
  const b = createHash("sha256").update(v).digest().subarray(0, 16);
  b[6] = (b[6] & 15) | 80;
  b[8] = (b[8] & 63) | 128;
  const s = b.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
function validate(candidate = data) {
  const counts = {},
    identities = new Set(),
    names = new Set();
  for (const r of candidate.rows) {
    const identity = articleKey(r);
    assert(
      r.manufacturer && r.sku && !identities.has(identity),
      "Duplicate or missing article: " + identity,
    );
    identities.add(identity);
    const normalized = normalize(r.displayName);
    assert(!names.has(normalized), "Duplicate specification: " + r.displayName);
    names.add(normalized);
    counts[r.family] = (counts[r.family] || 0) + 1;
    assert(r.description === r.displayName && r.displayName.length <= 255);
    assert(
      !/(listed in|manufacturer part number|source:|model:)/i.test(
        r.description,
      ),
      "Auxiliary information in description",
    );
    assert(r.connectionType === "Threaded", "Non-threaded item: " + identity);
    assert(
      ["Threaded Fittings", "Forged Threaded Fittings"].includes(r.category),
    );
    assert(
      ["Black 300#", "Carbon Steel", "Stainless steel"].includes(r.material),
    );
    assert(
      r.connectionSizes.length > 0 &&
        r.connectionSizes.every((s) => /^(?:\d+ |)\d+(?:\/\d+)?"$/.test(s)),
    );
    assert(
      r.sizeLabel === r.connectionSizes.join(" x ") ||
        (new Set(r.connectionSizes).size === 1 &&
          r.sizeLabel === r.connectionSizes[0]),
      "Size label mismatch: " + identity,
    );
    assert(
      r.sizeNominal === Math.max(...r.connectionSizes.map(nominal)),
      "Size nominal mismatch: " + identity,
    );
    assert(
      r.aliases.includes(r.sku) && r.aliases.includes(r.manufacturer),
      "Missing article aliases: " + identity,
    );
    assert(
      r.aliases.every(
        (s) => typeof s === "string" && s.length > 0 && s.length <= 255,
      ),
    );
    assert(
      r.sourceUrl?.startsWith("https://") && r.manufacturerDescription,
      "Missing source: " + identity,
    );
    assert(
      r.sourceRow || r.listingUrl || r.sourceUrl.includes("ProductDetail"),
      "Missing article source location: " + identity,
    );
    assert(r.fittingType && r.family);
    assert(
      !Object.keys(r).some((k) =>
        /^(price|listPrice|stock|availability)$/.test(k),
      ),
      "Unexpected commercial data",
    );
    if (r.material === "Black 300#") assert(r.pressureClass === "300");
    if (r.material === "Stainless steel")
      assert(/304|316/.test(r.grade), "Missing stainless grade: " + identity);
    const im = candidate.images[r.imageKey];
    assert(im, "Missing photo: " + identity);
    assert(im.imageKind === "product-photo", "Photo required: " + identity);
  }
  for (const im of Object.values(candidate.images)) {
    assert(
      path
        .resolve(im.path)
        .startsWith(path.resolve("public/images/catalog/uploads") + path.sep),
    );
    const buffer = fs.readFileSync(im.path);
    assert(
      hash(buffer) === im.sha256 && buffer.length === im.byteSize,
      "Photo hash mismatch",
    );
    assert(im.url === `/api/catalogue/images/part-${im.sha256}.webp`);
    assert(
      im.width >= 300 &&
        im.height >= 300 &&
        Math.max(im.sourceWidth, im.sourceHeight) >= 300 &&
        im.sourceUrl.startsWith("https://"),
    );
  }
  assert(candidate.rows.length > 0);
  return {
    articles: candidate.rows.length,
    counts,
    imageMappings: Object.keys(candidate.images).length,
    uniqueImages: new Set(
      Object.values(candidate.images).map((im) => im.sha256),
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
    ...(r.pressureClass ? { pressure_class: r.pressureClass } : {}),
    ...(r.grade ? { material_grade: r.grade } : {}),
    ...(r.standard ? { manufacturer_standard: r.standard } : {}),
    ...(r.model ? { manufacturer_model: r.model } : {}),
    ...(r.upc ? { upc: r.upc } : {}),
    ...(r.sourceRow
      ? {
          manufacturer_source_row: String(r.sourceRow),
          manufacturer_source_sheet: r.sourceSheet,
        }
      : {}),
    ...(r.listingUrl ? { manufacturer_listing: r.listingUrl } : {}),
    ...(r.manufacturerNote ? { manufacturer_note: r.manufacturerNote } : {}),
    ...(r.ratingSourceNote ? { rating_source_note: r.ratingSourceNote } : {}),
    ...(r.ratingNote ? { rating_note: r.ratingNote } : {}),
    ...(r.seatMaterial ? { seat_material: r.seatMaterial } : {}),
    ...(r.wall ? { wall: r.wall } : {}),
    ...(r.threadStandard ? { thread_standard: r.threadStandard } : {}),
    ...(r.pattern ? { fitting_pattern: r.pattern } : {}),
    ...(r.construction ? { construction: r.construction } : {}),
    ...(r.finish ? { finish: r.finish } : {}),
    ...(r.connectionEnds
      ? { connection_ends: JSON.stringify(r.connectionEnds) }
      : {}),
    ...(r.productPage ? { manufacturer_product_page: r.productPage } : {}),
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
        await tx`select "organizationId" from kublai_user where lower(email)=lower(${process.env.THREADED_FITTINGS_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com"})`;
      assert(
        users.length === 1 && users[0].organizationId,
        "Expected exactly one organization account",
      );
      const org = users[0].organizationId;
      if (apply)
        await tx`select pg_advisory_xact_lock(hashtext(${source + org}))`;
      const prepared = data.rows.map((r) => ({
        r,
        id: stable(source + org + articleKey(r)),
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
            (e) => normalize(e.displayName) === normalize(p.r.displayName),
          ),
          "Existing matching name requires review: " + p.r.displayName,
        );
        assert(
          !articleIds.some((e) => articleKey(e) === articleKey(p.r)),
          "Existing matching manufacturer article: " + p.r.sku,
        );
      }
      const [revisionBefore] =
        await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
      const summary = {
        mode: apply ? "apply" : "dry-run",
        ...validation,
        wouldCreate: pending.length,
        created: 0,
        alreadyPresent: prepared.length - pending.length,
      };
      if (!apply)
        return {
          ...summary,
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
              sourceHashes: Object.fromEntries(
                sourceFiles.map((file) => [file, hash(fs.readFileSync(file))]),
              ),
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
              await tx`insert into kublai_photo_asset ${tx({ id: randomUUID(), organizationId: org, storageKey: path.basename(im.path), url: im.url, originalFilename: `threaded-fitting-${key.replaceAll(":", "-")}.webp`, contentType: "image/webp", byteSize: im.byteSize, checksum: im.sha256, sourceUrl: im.sourceUrl, notes: im.notes, createdAt: new Date(), updatedAt: new Date() })} returning id`;
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
      const actualAssets =
        await tx`select a.* from kublai_photo_asset a join kublai_part_definition p on p."imageAssetId"=a.id where p.id in ${tx(prepared.map((p) => p.id))}`;
      const assetsById = new Map(actualAssets.map((a) => [a.id, a]));
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
        const asset = assetsById.get(p.imageAssetId);
        const image = data.images[r.imageKey];
        assert(
          asset &&
            asset.organizationId === org &&
            asset.url === image.url &&
            asset.checksum === image.sha256 &&
            asset.byteSize === image.byteSize &&
            asset.contentType === "image/webp",
          `${r.sku}: invalid photo asset`,
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
      if (pending.length) {
        const [listingCheck] =
          await tx`select count(*)::int total from kublai_supplier_part where "partDefinitionId" in ${tx(pending.map((p) => p.id))}`;
        assert(
          listingCheck.total === 0,
          "Unexpected supplier pricing/listing created",
        );
      }
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
module.exports = { validate, attributes, nominal, stable, articleKey };
