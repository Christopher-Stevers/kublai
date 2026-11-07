#!/usr/bin/env node
// @ts-nocheck
/** Idempotent, organization-scoped import of source-verified Victaulic fittings. */
require("dotenv/config");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const source = path.resolve("data/catalogue/victaulic-stainless-grooved.json");
const data = JSON.parse(fs.readFileSync(source, "utf8"));
const sourceName = "victaulic-stainless-grooved-20261017";
const email =
  process.env.VICTAULIC_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function stableId(value) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const s = bytes.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
function rowKey(r) {
  return JSON.stringify([
    r.source.publication,
    r.model,
    r.grade,
    r.schedule,
    r.system,
    r.variant,
    r.sizeLabel,
    r.actualOutsideDiametersMm,
  ]);
}
function validate() {
  const names = new Set(),
    keys = new Set();
  for (const r of data.rows) {
    if (
      !r.displayName ||
      r.displayName.length > 255 ||
      r.catalog !== "Plumbing" ||
      r.category !== "Fitting" ||
      r.manufacturer !== "Victaulic" ||
      !r.source.page ||
      !data.publications.some(
        (p) => p.number === r.source.publication && p.url === r.source.url,
      )
    )
      throw Error("Invalid row: " + r.displayName);
    if (
      !(r.sizeNominal > 0) ||
      r.sizeUnit !== "in" ||
      !["Stainless Steel Grooved", "Duplex Stainless Grooved"].includes(
        r.material,
      )
    )
      throw Error("Invalid size/material");
    const key = rowKey(r);
    if (keys.has(key) || names.has(r.displayName.toLowerCase()))
      throw Error("Duplicate row: " + r.displayName);
    keys.add(key);
    names.add(r.displayName.toLowerCase());
    if (r.aliases.some((a) => a.length > 255)) throw Error("Alias too long");
    if (r.imageUrl !== data.images[r.imageKey]?.url)
      throw Error("Missing verified image");
    const od = r.actualOutsideDiametersMm;
    if (
      od.length > 1 &&
      (!(od[0] > od.at(-1)) || (od.length === 3 && od[0] !== od[1]))
    )
      throw Error("Invalid reducing geometry: " + r.displayName);
  }
  for (const image of Object.values(data.images)) {
    const file = path.resolve(image.path);
    if (
      !file.startsWith(path.resolve("public/images/catalog/uploads") + path.sep)
    )
      throw Error("Unsafe asset path");
    if (
      hash(fs.readFileSync(file)) !== image.sha256 ||
      image.url !== `/api/catalogue/images/part-${image.sha256}.webp`
    )
      throw Error("Image checksum mismatch");
  }
  return {
    rows: data.rows.length,
    images: Object.keys(data.images).length,
    counts: data.countsByPublication,
  };
}
async function main() {
  const validation = validate();
  if (args.has("--validate-only")) {
    console.log(JSON.stringify({ ok: true, validation }, null, 2));
    return;
  }
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
  });
  try {
    const result = await sql.begin(apply ? "" : "read only", async (tx) => {
      const [user] =
        await tx`select id,"organizationId" from kublai_user where lower(email)=lower(${email}) limit 1`;
      if (!user?.organizationId)
        throw Error("Import account has no organization");
      const org = user.organizationId;
      if (apply)
        await tx`select pg_advisory_xact_lock(hashtext(${sourceName + org}))`;
      const [unit] =
        await tx`select id from kublai_unit where lower(code)='in' limit 1`;
      if (!unit) throw Error("Inch unit not found");
      const existing =
        await tx`select pd.* from kublai_part_definition pd where pd."organizationId"=${org} and (pd."displayName" ilike '%Victaulic%' or exists(select 1 from kublai_part_attribute a where a."partDefinitionId"=pd.id and a.key='source_import' and a."valueText"=${sourceName}))`;
      const byId = new Map(existing.map((p) => [p.id, p])),
        byName = new Map(existing.map((p) => [p.displayName.toLowerCase(), p]));
      const prepared = data.rows.map((r) => {
        const id = stableId(sourceName + org + rowKey(r));
        return {
          r,
          id:
            byId.get(id)?.id ||
            byName.get(r.displayName.toLowerCase())?.id ||
            id,
          existing: byId.get(id) || byName.get(r.displayName.toLowerCase()),
        };
      });
      const pending = prepared.filter((p) => !p.existing);
      if (!apply)
        return {
          mode: "dry-run",
          wouldCreate: pending.length,
          alreadyPresent: prepared.length - pending.length,
          validation,
        };
      const backupDir = path.resolve("state-backups");
      fs.mkdirSync(backupDir, { recursive: true });
      const backup = path.join(
        backupDir,
        sourceName + "-" + Date.now() + ".json",
      );
      const existingIds = existing.map((p) => p.id);
      const oldAttributes = existingIds.length
        ? await tx`select * from kublai_part_attribute where "partDefinitionId" in ${tx(existingIds)}`
        : [];
      const oldSynonyms = existingIds.length
        ? await tx`select * from kublai_part_synonym where "partDefinitionId" in ${tx(existingIds)}`
        : [];
      const [revisionBefore] =
        await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
      fs.writeFileSync(
        backup,
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            organizationId: org,
            existing,
            oldAttributes,
            oldSynonyms,
            plannedNewIds: pending.map((p) => p.id),
            sourceSha256: hash(fs.readFileSync(source)),
            revisionBefore,
          },
          null,
          2,
        ),
      );
      async function named(table, name, extra = {}) {
        const [old] =
          await tx`select id from ${tx(table)} where "organizationId"=${org} and lower(name)=lower(${name}) limit 1`;
        if (old) return old.id;
        const [item] =
          await tx`insert into ${tx(table)} ${tx({ id: randomUUID(), organizationId: org, name, ...extra })} returning id`;
        return item.id;
      }
      const catalogId = await named("kublai_catalog", "Plumbing", {
        sortOrder: 0,
        createdAt: new Date(),
        kind: "materials",
      });
      const categoryId = await named("kublai_category", "Fitting", {
        sortOrder: 1,
      });
      const materialIds = new Map();
      for (const name of new Set(data.rows.map((r) => r.material)))
        materialIds.set(
          name,
          await named("kublai_material", name, { createdAt: new Date() }),
        );
      const sizes =
        await tx`select id,nominal from kublai_size where "organizationId"=${org} and "unitId"=${unit.id}`;
      const sizeIds = new Map(sizes.map((s) => [Number(s.nominal), s.id]));
      for (const nominal of new Set(data.rows.map((r) => r.sizeNominal)))
        if (!sizeIds.has(nominal)) {
          const [s] =
            await tx`insert into kublai_size (id,"organizationId",nominal,"unitId","createdAt") values (${randomUUID()},${org},${String(nominal)},${unit.id},${new Date()}) on conflict ("organizationId",nominal,"unitId") do update set nominal=excluded.nominal returning id`;
          sizeIds.set(nominal, s.id);
        }
      const assets =
        await tx`select id,checksum,url from kublai_photo_asset where "organizationId"=${org}`;
      const assetByHash = new Map(
        assets.filter((a) => a.checksum).map((a) => [a.checksum, a]),
      );
      let newAssets = 0;
      for (const image of Object.values(data.images))
        if (!assetByHash.has(image.sha256)) {
          const item = {
            id: stableId(sourceName + org + image.sha256),
            organizationId: org,
            storageKey: path.basename(image.path),
            url: image.url,
            originalFilename: `Victaulic-${image.publication}-page-${image.page}-${image.model}.webp`,
            contentType: "image/webp",
            byteSize: image.byteSize,
            checksum: image.sha256,
            sourceUrl: image.sourceUrl,
            notes:
              "Verified manufacturer engineering illustration. Shared across published size/grade variants of this fitting shape.",
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          const [asset] =
            await tx`insert into kublai_photo_asset ${tx(item)} on conflict ("organizationId",url) do update set checksum=excluded.checksum returning id,checksum,url`;
          assetByHash.set(image.sha256, asset);
          newAssets++;
        }
      const inserted = pending.map(({ id, r }) => {
        const asset = assetByHash.get(data.images[r.imageKey].sha256);
        return {
          id,
          organizationId: org,
          catalogId,
          categoryId,
          displayName: r.displayName,
          description: r.description,
          imageUrl: asset.url,
          imageAssetId: asset.id,
          sizeLabel: r.sizeLabel,
          materialId: materialIds.get(r.material),
          sizeId: sizeIds.get(r.sizeNominal),
          isActive: true,
          createdAt: new Date(),
        };
      });
      for (let i = 0; i < inserted.length; i += 100)
        await tx`insert into kublai_part_definition ${tx(inserted.slice(i, i + 100))}`;
      // Only this import's provenance keys are touched; preserve all existing user data.
      const attrs = [];
      const synonyms = [];
      const existingSynonyms = new Set(
        oldSynonyms.map(
          (s) => s.partDefinitionId + "|" + s.synonym.toLowerCase(),
        ),
      );
      const existingAttrs = new Map(
        oldAttributes.map((a) => [
          a.partDefinitionId + "|" + a.key,
          a.valueText,
        ]),
      );
      for (const { id, r } of prepared) {
        const values = {
          manufacturer: "Victaulic",
          manufacturer_model: r.model,
          stainless_grade: r.grade,
          groove_system: r.system,
          construction: r.variant || "Standard",
          manufacturer_source: r.source.url,
          manufacturer_source_page: String(r.source.page),
          source_import: sourceName,
          source_key: rowKey(r),
          outside_diameters_mm: JSON.stringify(r.actualOutsideDiametersMm),
          manufacturer_dimensions: JSON.stringify(r.dimensions),
        };
        if (r.schedule) values.pipe_schedule = r.schedule;
        for (const [key, valueText] of Object.entries(values))
          if (!existingAttrs.has(id + "|" + key))
            attrs.push({
              id: stableId(sourceName + id + key),
              partDefinitionId: id,
              key,
              valueText,
            });
        for (const synonym of new Set([...r.aliases, `Victaulic ${r.model}`]))
          if (!existingSynonyms.has(id + "|" + synonym.toLowerCase())) {
            synonyms.push({
              id: stableId(sourceName + id + synonym.toLowerCase()),
              partDefinitionId: id,
              synonym,
            });
            existingSynonyms.add(id + "|" + synonym.toLowerCase());
          }
      }
      for (let i = 0; i < attrs.length; i += 200)
        await tx`insert into kublai_part_attribute ${tx(attrs.slice(i, i + 200))} on conflict ("partDefinitionId",key) do nothing`;
      for (let i = 0; i < synonyms.length; i += 200)
        await tx`insert into kublai_part_synonym ${tx(synonyms.slice(i, i + 200))}`;
      const importedIds = prepared.map((p) => p.id);
      const [check] =
        await tx`select count(*)::int parts,count(*) filter(where "imageUrl" is null or "imageAssetId" is null)::int "missingImages" from kublai_part_definition where "organizationId"=${org} and id in ${tx(importedIds)}`;
      if (check.parts !== data.rows.length || check.missingImages)
        throw Error("Post-import integrity check failed");
      const [revisionAfter] =
        await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
      return {
        mode: "apply",
        created: pending.length,
        alreadyPresent: prepared.length - pending.length,
        newAssets,
        attributesAdded: attrs.length,
        aliasesAdded: synonyms.length,
        verifiedParts: check.parts,
        missingImages: check.missingImages,
        backup,
        revisionBefore: revisionBefore?.revision,
        revisionAfter: revisionAfter?.revision,
        prices: "Not invented; supplier quotes required",
      };
    });
    console.log(JSON.stringify({ ok: true, validation, result }, null, 2));
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
