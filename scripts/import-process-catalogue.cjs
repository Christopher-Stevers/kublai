#!/usr/bin/env node
// @ts-nocheck -- validated standalone data import; no application/schema changes.
require("dotenv/config");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");
const sourceFiles = process.argv.flatMap((arg, index) =>
  arg === "--manifest" ? [process.argv[index + 1]] : [],
);
if (!sourceFiles.length) sourceFiles.push("data/catalogue/process-flange-branch.json");
const source = "process-catalogue-20261105";
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
const articleKey = (r) => [r.manufacturer || r.sourceVendor, r.skuKind || "manufacturer-part-number", r.sku].map(normalize).join(":");
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
      (r.manufacturer || r.sourceVendor) && r.sku && !identities.has(identity),
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
    assert(r.category && r.material && r.connectionType, "Missing catalogue facets: " + identity);
    assert(Array.isArray(r.connectionSizes), "Missing connection list: " + identity);
    assert(typeof r.sizeLabel === "string" && r.sizeLabel.length <= 100, "Invalid size label: " + identity);
    assert(r.sizeNominal == null || (Number.isFinite(r.sizeNominal) && r.sizeNominal > 0), "Invalid nominal size: " + identity);
    assert(["in", "mm"].includes(r.sizeUnit || "in"), "Unsupported size unit: " + identity);
    assert(r.aliases.includes(r.sku) && r.aliases.includes(r.manufacturer || r.sourceVendor), "Missing article aliases: " + identity);
    assert(
      r.aliases.every(
        (s) => typeof s === "string" && s.length > 0 && s.length <= 255,
      ),
    );
    assert(
      r.sourceUrl?.startsWith("https://") && r.manufacturerDescription,
      "Missing source: " + identity,
    );
    assert(r.fittingType && r.family);
    assert(
      !Object.keys(r).some((k) =>
        /^(price|listPrice|stock|availability)$/.test(k),
      ),
      "Unexpected commercial data",
    );
    attributes(r); // Validate all preserved source metadata before opening a transaction.
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
        Math.max(im.sourceWidth, im.sourceHeight) >= 250 &&
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
  const attrs = {
    ...(r.manufacturer ? { manufacturer: r.manufacturer } : {}),
    ...(r.sourceVendor ? { source_vendor: r.sourceVendor } : {}),
    ...(r.skuKind === "catalogue-variant-id"
      ? { source_variant_id: r.sku }
      : { manufacturer_part_number: r.sku }),
    source_article_kind: r.skuKind || "manufacturer-part-number",
    manufacturer_source: r.sourceUrl,
    manufacturer_description: r.manufacturerDescription,
    source_import: source,
    connection_type: r.connectionType,
    connections: JSON.stringify(r.connectionSizes),
    fitting_type: r.fittingType,
    size_unit: r.sizeUnit || "in",
  };
  const names = {
    pressureClass: "pressure_class", grade: "material_grade", standard: "manufacturer_standard",
    model: "manufacturer_model", sourceRow: "manufacturer_source_row", sourceSheet: "manufacturer_source_sheet",
    listingUrl: "manufacturer_listing", manufacturerNote: "manufacturer_note", ratingSourceNote: "rating_source_note",
    ratingNote: "rating_note", seatMaterial: "seat_material", threadStandard: "thread_standard",
    pattern: "fitting_pattern", connectionEnds: "connection_ends", productPage: "manufacturer_product_page",
  };
  const reserved = new Set(["sku", "skuKind", "manufacturer", "sourceVendor", "sourceUrl", "manufacturerDescription", "connectionType", "connectionSizes", "fittingType", "sizeUnit", "sizeNominal", "sizeLabel", "category", "material", "displayName", "description", "aliases", "imageKey", "attributes"]);
  for (const [key, value] of Object.entries(r)) {
    if (reserved.has(key) || value == null || value === "") continue;
    const name = names[key] || key.replace(/[A-Z]/g, c => "_" + c.toLowerCase());
    attrs[name] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  for (const [key, value] of Object.entries(r.attributes || {})) {
    assert(typeof value === "string" && value.length > 0, "Invalid extra attribute: " + key);
    assert(!(key in attrs) || attrs[key] === value, "Conflicting attribute: " + key);
    attrs[key] = value;
  }
  return attrs;
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
        await tx`select "organizationId" from kublai_user where lower(email)=lower(${process.env.PROCESS_CATALOGUE_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com"})`;
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
        await tx`select p.id, max(a."valueText") filter(where a.key='manufacturer') manufacturer,coalesce(max(a."valueText") filter(where a.key='manufacturer_part_number'),max(a."valueText") filter(where a.key='source_variant_id')) sku,max(a."valueText") filter(where a.key='source_vendor') "sourceVendor",max(a."valueText") filter(where a.key='source_article_kind') "skuKind" from kublai_part_definition p join kublai_part_attribute a on a."partDefinitionId"=p.id where p."organizationId"=${org} and a.key in ('manufacturer','manufacturer_part_number','source_variant_id','source_vendor','source_article_kind') group by p.id`;
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
        const sizes = new Map();
        for (const unitCode of new Set(data.rows.filter(r => r.sizeNominal != null).map(r => r.sizeUnit || "in"))) {
          const [unit] = await tx`select id from kublai_unit where code=${unitCode}`;
          assert(unit, "Missing size unit: " + unitCode);
          for (const item of await tx`select id,nominal from kublai_size where "organizationId"=${org} and "unitId"=${unit.id}`)
            sizes.set(unitCode + ":" + Number(item.nominal), item.id);
          for (const n of new Set(data.rows.filter(r => r.sizeNominal != null && (r.sizeUnit || "in") === unitCode).map(r => r.sizeNominal))) {
            const key = unitCode + ":" + n;
            if (sizes.has(key)) continue;
            const [item] = await tx`insert into kublai_size ${tx({ id: randomUUID(), organizationId: org, nominal: String(n), unitId: unit.id, createdAt: new Date() })} returning id`;
            sizes.set(key, item.id);
          }
        }
        const assets = new Map();
        for (const [key, im] of Object.entries(data.images)) {
          let [asset] =
            await tx`select id from kublai_photo_asset where "organizationId"=${org} and url=${im.url}`;
          if (!asset)
            [asset] =
              await tx`insert into kublai_photo_asset ${tx({ id: randomUUID(), organizationId: org, storageKey: path.basename(im.path), url: im.url, originalFilename: `process-part-${key.replaceAll(":", "-")}.webp`, contentType: "image/webp", byteSize: im.byteSize, checksum: im.sha256, sourceUrl: im.sourceUrl, notes: im.notes, createdAt: new Date(), updatedAt: new Date() })} returning id`;
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
            sizeId: r.sizeNominal == null ? null : sizes.get((r.sizeUnit || "in") + ":" + r.sizeNominal),
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
        await tx`select p.*,m.name material,c.name category,cat.name catalog,s.nominal,u.code "sizeUnit" from kublai_part_definition p join kublai_material m on m.id=p."materialId" join kublai_category c on c.id=p."categoryId" join kublai_catalog cat on cat.id=p."catalogId" left join kublai_size s on s.id=p."sizeId" left join kublai_unit u on u.id=s."unitId" where p."organizationId"=${org} and p.id in ${tx(prepared.map((p) => p.id))}`;
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
        ])
          assert(p[key] === r[key], `${r.sku}: ${key} mismatch`);
        for (const key of ["material", "category"])
          assert(normalize(p[key]) === normalize(r[key]), `${r.sku}: ${key} mismatch`);
        assert(
          p.catalog === "Plumbing" &&
            (r.sizeNominal == null ? p.nominal == null : Number(p.nominal) === r.sizeNominal && p.sizeUnit === (r.sizeUnit || "in")) &&
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
