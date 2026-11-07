#!/usr/bin/env node
// @ts-nocheck -- same runtime validation approach as other catalogue importers.
// Additive, organization-scoped, repeatable import. No changes to prices or existing parts.
require("dotenv/config");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");
const sourceFile = "data/catalogue/megapress-stainless.json";
const source = "viega-megapress-stainless-20261104";
const data = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
const apply = process.argv.includes("--apply");
const hash = (value) => createHash("sha256").update(value).digest("hex");
function stable(value) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const s = bytes.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
function validate() {
  const skus = new Set(),
    names = new Set(),
    counts = {},
    models = {};
  for (const row of data.rows) {
    const spec = data.families[row.family];
    const expectedMaterial = `MegaPress Stainless ${spec?.grade} (${spec?.seal})`;
    if (
      !spec ||
      !/^\d{5,}$/.test(row.sku) ||
      skus.has(row.sku) ||
      names.has(row.displayName.toLowerCase()) ||
      row.displayName.length > 255 ||
      !row.displayName.includes("MegaPress Stainless") ||
      row.material !== expectedMaterial ||
      row.grade !== spec.grade ||
      row.seal !== spec.seal ||
      row.sizeNominal < 0.5 ||
      row.sizeNominal > 4 ||
      !row.sourceUrl.startsWith(
        `https://www.viega.us/en/products/Catalog/Metal-systems/${row.family}/`,
      ) ||
      !data.images[row.imageKey] ||
      row.category !== "Fitting" ||
      row.aliases.some((s) => s.length > 255)
    )
      throw Error("Invalid article " + row.sku);
    if (
      row.articleData["Part No"].split(/\s+/)[0] !== row.sku ||
      !Object.keys(row.connections).length ||
      !Object.values(row.connections).every((s) => row.sizeLabel.includes(s))
    )
      throw Error("Article table mismatch " + row.sku);
    skus.add(row.sku);
    names.add(row.displayName.toLowerCase());
    counts[row.family] = (counts[row.family] || 0) + 1;
    models[row.imageKey] = (models[row.imageKey] || 0) + 1;
  }
  if (
    Object.keys(counts).length !== 3 ||
    Object.values(counts).some((n) => n < 100) ||
    JSON.stringify(counts) !== JSON.stringify(data.counts)
  )
    throw Error("Incomplete family inventory");
  for (const [key, image] of Object.entries(data.images)) {
    if (
      models[key] !== data.modelCounts[key] ||
      !path
        .resolve(image.path)
        .startsWith(path.resolve("public/images/catalog/uploads") + path.sep) ||
      hash(fs.readFileSync(image.path)) !== image.sha256 ||
      fs.statSync(image.path).size !== image.byteSize ||
      image.url !== `/api/catalogue/images/part-${image.sha256}.webp` ||
      !image.sourceUrl.startsWith("https://web-catalog.viega.com/")
    )
      throw Error("Invalid image/model " + key);
  }
  return {
    articles: data.rows.length,
    models: Object.keys(data.images).length,
    counts,
  };
}
async function main() {
  const validation = validate();
  if (process.argv.includes("--validate-only")) {
    console.log(JSON.stringify(validation, null, 2));
    return;
  }
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    connect_timeout: 10,
  });
  try {
    const result = await sql.begin(apply ? "" : "read only", async (tx) => {
      const users =
        await tx`select id,"organizationId" from kublai_user where lower(email)=lower(${process.env.MEGAPRESS_STAINLESS_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com"})`;
      if (users.length !== 1 || !users[0].organizationId)
        throw Error("Expected exactly one organization account");
      const org = users[0].organizationId;
      if (apply)
        await tx`select pg_advisory_xact_lock(hashtext(${source + org}))`;
      const existing =
        await tx`select p.id,p."displayName" from kublai_part_definition p where p."organizationId"=${org} and (p."displayName" ilike '%megapress%' or exists(select 1 from kublai_part_attribute a where a."partDefinitionId"=p.id and a.key='manufacturer_part_number' and a."valueText" in ${tx(data.rows.map((r) => r.sku))}))`;
      const prepared = data.rows.map((r) => ({
        r,
        id: stable(source + org + r.sku),
      }));
      const ids = new Set(existing.map((p) => p.id));
      const pending = prepared.filter((p) => !ids.has(p.id));
      const existingSkus = existing.length
        ? await tx`select "partDefinitionId","valueText" from kublai_part_attribute where key='manufacturer_part_number' and "partDefinitionId" in ${tx(existing.map((p) => p.id))}`
        : [];
      for (const p of pending) {
        if (
          existing.some(
            (e) =>
              e.displayName.toLowerCase() === p.r.displayName.toLowerCase(),
          ) ||
          existingSkus.some((e) => e.valueText === p.r.sku)
        )
          throw Error("Existing article requires review: " + p.r.sku);
      }
      const [revisionBefore] =
        await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
      if (!apply || !pending.length)
        return {
          mode: apply ? "apply" : "dry-run",
          ...validation,
          wouldCreate: pending.length,
          created: 0,
          alreadyPresent: prepared.length - pending.length,
          revision: revisionBefore?.revision,
        };
      fs.mkdirSync("state-backups", { recursive: true });
      const backup = `state-backups/${source}-${Date.now()}.json`;
      fs.writeFileSync(
        backup,
        JSON.stringify(
          {
            org,
            existing,
            plannedNewIds: pending.map((p) => p.id),
            sourceHash: hash(fs.readFileSync(sourceFile)),
            revisionBefore,
          },
          null,
          2,
        ),
      );
      const named = async (table, name, extra = {}) => {
        const matches =
          await tx`select id from ${tx(table)} where "organizationId"=${org} and lower(name)=lower(${name})`;
        if (matches.length > 1)
          throw Error("Ambiguous catalogue facet " + name);
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
      const categoryId = await named("kublai_category", "Fitting", {
        sortOrder: 1,
      });
      const materials = new Map();
      for (const material of new Set(data.rows.map((r) => r.material)))
        materials.set(
          material,
          await named("kublai_material", material, {
            groupPath: tx.json(["Press"]),
            createdAt: new Date(),
          }),
        );
      const [unit] = await tx`select id from kublai_unit where code='in'`;
      if (!unit) throw Error("Missing inch unit");
      const sizeRows =
        await tx`select id,nominal from kublai_size where "organizationId"=${org} and "unitId"=${unit.id}`;
      const sizes = new Map(sizeRows.map((s) => [Number(s.nominal), s.id]));
      for (const nominal of new Set(data.rows.map((r) => r.sizeNominal)))
        if (!sizes.has(nominal)) {
          const [size] =
            await tx`insert into kublai_size ${tx({ id: randomUUID(), organizationId: org, nominal: String(nominal), unitId: unit.id, createdAt: new Date() })} returning id`;
          sizes.set(nominal, size.id);
        }
      const assets = new Map();
      for (const [key, image] of Object.entries(data.images)) {
        let [asset] =
          await tx`select id from kublai_photo_asset where "organizationId"=${org} and url=${image.url}`;
        if (!asset)
          [asset] =
            await tx`insert into kublai_photo_asset ${tx({ id: randomUUID(), organizationId: org, storageKey: path.basename(image.path), url: image.url, originalFilename: `Viega-MegaPress-Stainless-${image.model}.webp`, contentType: "image/webp", byteSize: image.byteSize, checksum: image.sha256, sourceUrl: image.sourceUrl, notes: "Manufacturer model image; shared across published model sizes.", createdAt: new Date(), updatedAt: new Date() })} returning id`;
        assets.set(key, asset.id);
      }
      for (const { id, r } of pending) {
        await tx`insert into kublai_part_definition ${tx({ id, organizationId: org, catalogId, categoryId, materialId: materials.get(r.material), sizeId: sizes.get(r.sizeNominal), displayName: r.displayName, description: r.description, sizeLabel: r.sizeLabel, imageUrl: data.images[r.imageKey].url, imageAssetId: assets.get(r.imageKey), isActive: true, createdAt: new Date() })}`;
        const attributes = {
          manufacturer: "Viega",
          manufacturer_model: r.model,
          manufacturer_part_number: r.sku,
          manufacturer_source: r.sourceUrl,
          source_import: source,
          stainless_grade: r.grade,
          seal_material: r.seal,
          manufacturer_article_data: JSON.stringify(r.articleData),
          connections: JSON.stringify(r.connections),
          ...(r.availability ? { availability: r.availability } : {}),
        };
        await tx`insert into kublai_part_attribute ${tx(Object.entries(attributes).map(([key, valueText]) => ({ id: randomUUID(), partDefinitionId: id, key, valueText })))}`;
        await tx`insert into kublai_part_synonym ${tx([...new Set(r.aliases)].map((synonym) => ({ id: randomUUID(), partDefinitionId: id, synonym })))}`;
      }
      const [check] =
        await tx`select count(*)::int total,count(*) filter(where "imageAssetId" is null or "sizeId" is null or not "isActive")::int incomplete from kublai_part_definition where "organizationId"=${org} and id in ${tx(prepared.map((p) => p.id))}`;
      if (check.total !== data.rows.length || check.incomplete)
        throw Error("Catalogue verification failed");
      const [revisionAfter] =
        await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
      if (
        Number(revisionAfter?.revision || 0) <=
        Number(revisionBefore?.revision || 0)
      )
        throw Error("Catalogue sync revision did not advance");
      return {
        mode: "apply",
        ...validation,
        created: pending.length,
        alreadyPresent: prepared.length - pending.length,
        ...check,
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
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
