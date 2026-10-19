#!/usr/bin/env node
// Organization-scoped, idempotent import; published prices are reference attributes only.
require("dotenv/config");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");
const sourceName = "cb-steel-nipples-20261019";
const data = JSON.parse(
  fs.readFileSync("data/catalogue/cb-steel-nipples.json"),
);
const apply = process.argv.includes("--apply");
const hash = (v) => createHash("sha256").update(v).digest("hex");
const stable = (v) => {
  const s = hash(v);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-5${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
};
function validate() {
  if (
    data.rows.length !== 587 ||
    new Set(data.rows.map((r) => r.sku)).size !== 587 ||
    new Set(data.rows.map((r) => r.displayName)).size !== 587
  )
    throw Error("Unexpected/duplicate rows");
  for (const r of data.rows) {
    if (
      !data.images[r.imageKey] ||
      r.displayName.length > 255 ||
      !r.source.page ||
      r.sizeNominal <= 0 ||
      !["40", "80"].includes(r.pipeSchedule) ||
      !/^\d{9}$/.test(r.sku)
    )
      throw Error("Invalid row " + r.sku);
    if (
      r.aliases.some((s) => s.length > 255) ||
      !data.publications.some((p) => p.url === r.source.url)
    )
      throw Error("Invalid provenance");
    if (r.lengthLabel === "CLOSE" && r.lengthInches !== null)
      throw Error("Invented close length");
    if (r.material === "Galvanized Steel" && !r.sku.startsWith("422"))
      throw Error("Invalid galvanized variant");
    if (r.thread === "Left x Right Hand" && r.pipeSchedule !== "40")
      throw Error("L-R is standard, not XH");
  }
  for (const i of Object.values(data.images))
    if (hash(fs.readFileSync(i.path)) !== i.sha256)
      throw Error("Image checksum mismatch");
  return {
    parts: data.rows.length,
    images: Object.keys(data.images).length,
    counts: data.counts,
  };
}
async function main() {
  const validation = validate();
  if (process.argv.includes("--validate-only")) return console.log(validation);
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const result = await sql.begin(apply ? "" : "read only", async (tx) => {
      const [job] =
        await tx`select "organizationId" org from kublai_job where id='0391aed4-7773-47ec-9141-09df373ec008'`;
      if (!job?.org) throw Error("Alma organization missing");
      const org = job.org;
      if (apply)
        await tx`select pg_advisory_xact_lock(hashtext(${sourceName + org}))`;
      const all =
        await tx`select p.* from kublai_part_definition p where p."organizationId"=${org}`;
      const synonyms =
        await tx`select s.* from kublai_part_synonym s join kublai_part_definition p on p.id=s."partDefinitionId" where p."organizationId"=${org}`;
      const byName = new Map(all.map((p) => [p.displayName.toLowerCase(), p]));
      const byId = new Map(all.map((p) => [p.id, p]));
      const prepared = data.rows.map((r) => {
        const id = stable(sourceName + org + r.sku);
        const old = byId.get(id) || byName.get(r.displayName.toLowerCase());
        const skuConflicts = synonyms.filter(
          (s) =>
            [r.sku, "CB Supplies " + r.sku].includes(s.synonym) &&
            s.partDefinitionId !== old?.id,
        );
        if (skuConflicts.length)
          throw Error("Existing SKU needs review: " + r.sku);
        return { r, id: old?.id || id, old };
      });
      const pending = prepared.filter((p) => !p.old);
      if (!apply)
        return {
          wouldCreate: pending.length,
          alreadyPresent: prepared.length - pending.length,
        };
      const ids = prepared.map((p) => p.id);
      const [revisionBefore] =
        await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
      fs.mkdirSync("state-backups", { recursive: true });
      const backup = `state-backups/${sourceName}-${Date.now()}.json`;
      fs.writeFileSync(
        backup,
        JSON.stringify(
          {
            organizationId: org,
            sourceHash: hash(
              fs.readFileSync("data/catalogue/cb-steel-nipples.json"),
            ),
            plannedNewIds: pending.map((p) => p.id),
            existing: prepared.filter((p) => p.old).map((p) => p.old),
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
        const [row] =
          await tx`insert into ${tx(table)} ${tx({ id: randomUUID(), organizationId: org, name, ...extra })} returning id`;
        return row.id;
      }
      const catalogId = await named("kublai_catalog", "Plumbing", {
        sortOrder: 0,
        createdAt: new Date(),
        kind: "materials",
      });
      const categoryId = await named("kublai_category", "Fitting", {
        sortOrder: 1,
      });
      const mats = new Map();
      for (const m of new Set(data.rows.map((r) => r.material)))
        mats.set(
          m,
          await named("kublai_material", m, { createdAt: new Date() }),
        );
      const [unit] =
        await tx`select id from kublai_unit where lower(code)='in' limit 1`;
      if (!unit) throw Error("Inch unit missing");
      const sizes = new Map();
      for (const n of new Set(data.rows.map((r) => r.sizeNominal))) {
        const [old] =
          await tx`select id from kublai_size where "organizationId"=${org} and "unitId"=${unit.id} and nominal=${n}`;
        if (old) sizes.set(n, old.id);
        else {
          const [s] =
            await tx`insert into kublai_size (id,"organizationId",nominal,"unitId","createdAt") values (${randomUUID()},${org},${String(n)},${unit.id},now()) returning id`;
          sizes.set(n, s.id);
        }
      }
      const assets = new Map();
      let newAssets = 0;
      for (const [key, i] of Object.entries(data.images)) {
        let [asset] =
          await tx`select id,url from kublai_photo_asset where "organizationId"=${org} and checksum=${i.sha256} limit 1`;
        if (!asset) {
          [asset] =
            await tx`insert into kublai_photo_asset ${tx({ id: stable(sourceName + org + i.sha256), organizationId: org, storageKey: path.basename(i.path), url: i.url, originalFilename: `CB-Supplies-${key}.webp`, contentType: "image/webp", byteSize: i.byteSize, checksum: i.sha256, sourceUrl: i.sourceUrl, notes: `Manufacturer catalogue family photo, ${i.publication} page ${i.page}; shared across sizes.`, createdAt: new Date(), updatedAt: new Date() })} returning id,url`;
          newAssets++;
        }
        assets.set(key, asset);
      }
      for (const { id, r } of pending) {
        const a = assets.get(r.imageKey);
        await tx`insert into kublai_part_definition ${tx({ id, organizationId: org, catalogId, categoryId, displayName: r.displayName, description: r.description, imageUrl: a.url, imageAssetId: a.id, sizeLabel: r.sizeLabel, materialId: mats.get(r.material), sizeId: sizes.get(r.sizeNominal), piecesPerPack: r.piecesPerPack, bulkUnit: r.bulkUnit, individualUnit: r.individualUnit, isActive: true, createdAt: new Date() })}`;
      }
      let attrsAdded = 0,
        aliasesAdded = 0;
      for (const { id, r } of prepared) {
        const values = {
          manufacturer: "CB Supplies",
          manufacturer_part_number: r.sku,
          manufacturer_source: r.source.url,
          manufacturer_source_page: String(r.source.page),
          source_import: sourceName,
          pipe_schedule: r.pipeSchedule,
          connection: r.thread,
          finish: r.finish,
          nominal_diameter_inches: String(r.sizeNominal),
          length_label: r.lengthLabel || "Assorted",
          manufacturer_description: r.supplierDescription,
          manufacturer_upc_as_published: r.upc,
          published_list_price_cad: r.publishedListPrice,
          published_list_price_effective_date: r.priceEffectiveDate,
          price_status:
            "Manufacturer list reference only; not a supplier quote",
        };
        if (r.lengthInches !== null)
          values.length_inches = String(r.lengthInches);
        if (r.material === "Stainless steel") values.stainless_grade = "304";
        for (const [key, valueText] of Object.entries(values)) {
          const a =
            await tx`insert into kublai_part_attribute ${tx({ id: stable(sourceName + id + key), partDefinitionId: id, key, valueText })} on conflict ("partDefinitionId",key) do nothing returning id`;
          attrsAdded += a.length;
        }
        for (const synonym of new Set(r.aliases)) {
          if (
            !synonyms.some(
              (s) =>
                s.partDefinitionId === id &&
                s.synonym.toLowerCase() === synonym.toLowerCase(),
            )
          ) {
            await tx`insert into kublai_part_synonym ${tx({ id: stable(sourceName + id + synonym), partDefinitionId: id, synonym })}`;
            aliasesAdded++;
          }
        }
      }
      const [check] =
        await tx`select count(*)::int parts,count(*) filter(where "imageUrl" is null or "imageAssetId" is null)::int "missingImages" from kublai_part_definition where "organizationId"=${org} and id in ${tx(ids)}`;
      if (check.parts !== 587 || check.missingImages)
        throw Error("Integrity check failed");
      const [revisionAfter] =
        await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
      return {
        created: pending.length,
        alreadyPresent: prepared.length - pending.length,
        newAssets,
        attrsAdded,
        aliasesAdded,
        ...check,
        backup,
        revisionBefore,
        revisionAfter,
      };
    });
    console.log(JSON.stringify({ validation, result }, null, 2));
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
