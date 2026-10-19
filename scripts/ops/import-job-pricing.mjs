// An explicit, reviewed manifest is required. No fuzzy matching or price guessing at write time.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import sharp from "sharp";

const file = process.argv[2];
const apply = process.argv.includes("--apply");
if (!file)
  throw Error(
    "Usage: node scripts/ops/import-job-pricing.mjs reviewed-manifest.json [--apply]",
  );
const raw = await fs.readFile(file, "utf8");
const manifest = JSON.parse(raw);
const digest = createHash("sha256").update(raw).digest("hex");
if (
  manifest.version !== 1 ||
  !Array.isArray(manifest.rows) ||
  !manifest.rows.length
)
  throw Error("Invalid import manifest");
const ids = new Set();
for (const r of manifest.rows) {
  if (ids.has(r.supplierSku) || !r.supplierSku)
    throw Error("Duplicate or blank supplier SKU");
  ids.add(r.supplierSku);
  if (
    !Number.isFinite(r.unitCost) ||
    r.unitCost <= 0 ||
    r.priceStatus !== "estimated"
  )
    throw Error("Expected positive, explicitly estimated seed prices");
  if (
    r.newPart &&
    (!r.newPart.imageUrl || !r.newPart.imageAssetId || !r.newPart.displayName)
  )
    throw Error(`Incomplete new part ${r.supplierSku}`);
}
const connection = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  if (apply && manifest.supplierPriceBookName) {
    throw Error("This manifest now belongs to a supplier price book. Use Suppliers > View Price Books to maintain it; the legacy importer must not bypass book membership.");
  }
  const [scope] =
    await connection`select j.name as job,s.name as supplier from kublai_job j join kublai_supplier s on s.id=${manifest.supplierId} where j.id=${manifest.jobId} and j."organizationId"=${manifest.organizationId} and s."organizationId"=${manifest.organizationId}`;
  if (!scope) throw Error("Job/supplier organization mismatch");
  const [actor] =
    await connection`select id from kublai_user where "organizationId"=${manifest.organizationId} and email='tim.j.saunders@gmail.com'`;
  if (!actor) throw Error("Import owner not found in this organization");
  const existing =
    await connection`select id,"displayName","description" from kublai_part_definition where "organizationId"=${manifest.organizationId}`;
  const partIds = new Set(existing.map((r) => r.id));
  for (const r of manifest.rows)
    if (!r.newPart && !partIds.has(r.partDefinitionId))
      throw Error(`Missing approved part ${r.partDefinitionId}`);
  console.log({
    mode: apply ? "apply" : "validate",
    job: scope.job,
    supplier: scope.supplier,
    rows: manifest.rows.length,
    newParts: manifest.rows.filter(
      (r) => r.newPart && !partIds.has(r.partDefinitionId),
    ).length,
    manifestHash: digest,
  });
  if (!apply) process.exitCode = 0;
  else {
    // Save a local, restricted audit snapshot before modifying catalogue or supplier relationships.
    const folder = path.join(
      process.env.HOME,
      ".local/share/foremanhq-import-backups",
      `job-pricing-${Date.now()}`,
    );
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const backup = {
      manifestHash: digest,
      parts:
        await connection`select * from kublai_part_definition where "organizationId"=${manifest.organizationId}`,
      listings:
        await connection`select * from kublai_supplier_part where "organizationId"=${manifest.organizationId}`,
      aliases:
        await connection`select a.* from kublai_part_synonym a join kublai_part_definition p on p.id=a."partDefinitionId" where p."organizationId"=${manifest.organizationId}`,
    };
    await fs.writeFile(
      path.join(folder, "before.json"),
      JSON.stringify(backup),
      { mode: 0o600 },
    );
    await fs.writeFile(path.join(folder, "manifest.json"), raw, {
      mode: 0o600,
    });
    // Only the few new shared family photos need bytes. Existing image URLs/assets are reused.
    const prepared = [];
    for (const asset of manifest.newPhotoAssets ?? []) {
      const destination = path.resolve(
        "public/images/catalog/uploads",
        asset.storageKey,
      );
      if (!/^part-[0-9a-f-]+\.webp$/.test(asset.storageKey))
        throw Error("Invalid photo filename");
      let bytes = await fs.readFile(destination).catch(() => null);
      if (!bytes) {
        const response = await fetch(asset.sourceUrl, {
          signal: AbortSignal.timeout(30000),
          headers: { "User-Agent": "ForemanHQ catalogue import" },
        });
        if (!response.ok)
          throw Error(
            `Image download failed (${response.status}): ${asset.pageUrl}`,
          );
        const input = Buffer.from(await response.arrayBuffer());
        if (input.length > 12 * 1024 * 1024) throw Error("Photo exceeds 12 MB");
        bytes = await sharp(input)
          .rotate()
          .resize(800, 800, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 88 })
          .toBuffer();
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, bytes, { flag: "wx" });
      }
      prepared.push({
        ...asset,
        byteSize: bytes.length,
        checksum: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    const report = await connection.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout='5s'`;
      await tx`SET LOCAL statement_timeout='120s'`;
      await tx`select pg_advisory_xact_lock(hashtext(${`${manifest.organizationId}:${manifest.jobId}:orders`}))`;
      const [catalog] =
        await tx`select id from kublai_catalog where "organizationId"=${manifest.organizationId} and name='Plumbing'`;
      if (!catalog) throw Error("Plumbing catalogue not found");
      const [unit] =
        await tx`select id from kublai_unit where code='in' limit 1`;
      for (const a of prepared)
        await tx`insert into kublai_photo_asset (id,"organizationId","storageKey",url,"originalFilename","contentType","byteSize",checksum,"sourceUrl",notes,"createdAt","updatedAt") values (${a.id},${manifest.organizationId},${a.storageKey},${a.url},${a.storageKey},'image/webp',${a.byteSize},${a.checksum},${a.sourceUrl},${a.notes + " Source page: " + a.pageUrl},now(),now()) on conflict (id) do nothing`;
      let created = 0,
        aliases = 0,
        listings = 0,
        entries = 0;
      const [policy] =
        await tx`insert into kublai_job_price_list (id,"organizationId","jobId",name,currency) values (${randomUUID()},${manifest.organizationId},${manifest.jobId},${manifest.name},'CAD') on conflict ("jobId") do update set name=kublai_job_price_list.name returning id`;
      for (const row of manifest.rows) {
        const p = row.newPart;
        if (p && !partIds.has(p.id)) {
          const [category] =
            await tx`insert into kublai_category (id,"organizationId",name) values (${randomUUID()},${manifest.organizationId},${p.category}) on conflict ("organizationId",name) do update set name=excluded.name returning id`;
          let materialId = null,
            sizeId = null;
          if (p.material) {
            const [m] =
              await tx`select id from kublai_material where "organizationId"=${manifest.organizationId} and name=${p.material} limit 1`;
            if (m) materialId = m.id;
            else {
              const [n] =
                await tx`insert into kublai_material (id,"organizationId",name,"createdAt") values (${randomUUID()},${manifest.organizationId},${p.material},now()) returning id`;
              materialId = n.id;
            }
          }
          if (p.nominal && unit) {
            const [s] =
              await tx`select id from kublai_size where "organizationId"=${manifest.organizationId} and nominal=${p.nominal} and "unitId"=${unit.id} limit 1`;
            if (s) sizeId = s.id;
            else {
              const [n] =
                await tx`insert into kublai_size (id,"organizationId",nominal,"unitId","createdAt") values (${randomUUID()},${manifest.organizationId},${p.nominal},${unit.id},now()) returning id`;
              sizeId = n.id;
            }
          }
          await tx`insert into kublai_part_definition (id,"organizationId","catalogId","categoryId","displayName",description,"imageUrl","imageAssetId","sizeLabel","materialId","sizeId","piecesPerPack","bulkUnit","individualUnit","sortOrder","isActive","createdAt") values (${p.id},${manifest.organizationId},${catalog.id},${category.id},${p.displayName},${p.description},${p.imageUrl},${p.imageAssetId},${p.sizeLabel},${materialId},${sizeId},${p.piecesPerPack},${p.bulkUnit},${p.individualUnit},0,true,now())`;
          partIds.add(p.id);
          created++;
        }
        // Preserve existing ForemanHQ names, descriptions, photos, and catalogue prices.
        for (const alias of row.aliases) {
          const exists =
            await tx`select id from kublai_part_synonym where "partDefinitionId"=${row.partDefinitionId} and lower(synonym)=lower(${alias}) limit 1`;
          if (!exists.length) {
            await tx`insert into kublai_part_synonym (id,"partDefinitionId",synonym) values (${randomUUID()},${row.partDefinitionId},${alias})`;
            aliases++;
          }
        }
        let [listing] =
          await tx`select * from kublai_supplier_part where "organizationId"=${manifest.organizationId} and "supplierId"=${manifest.supplierId} and "supplierSku"=${row.supplierSku}`;
        if (listing && listing.partDefinitionId !== row.partDefinitionId)
          throw Error(
            `Supplier SKU already belongs to a different part: ${row.supplierSku}`,
          );
        if (!listing) {
          const [previous] =
            await tx`select "packSize" from kublai_supplier_part where "organizationId"=${manifest.organizationId} and "supplierId"=${manifest.supplierId} and "partDefinitionId"=${row.partDefinitionId} order by "isPreferred" desc,"createdAt" limit 1`;
          [listing] =
            await tx`insert into kublai_supplier_part (id,"organizationId","supplierId","partDefinitionId","supplierSku","supplierName","packSize",currency,"isPreferred",notes,"createdAt") values (${randomUUID()},${manifest.organizationId},${manifest.supplierId},${row.partDefinitionId},${row.supplierSku},${row.supplierDescription || null},${previous?.packSize ?? null},'CAD',false,${"Alma approved match import " + manifest.reviewRevision + (row.sourceStockNote ? ". " + row.sourceStockNote : "")},now()) returning *`;
          listings++;
        }
        const inserted =
          await tx`insert into kublai_job_price_entry (id,"priceListId","supplierPartId","sourceDescription","unitCost","priceStatus","priceBasis","priceSource") values (${randomUUID()},${policy.id},${listing.id},${row.supplierDescription || null},${row.unitCost},'estimated',${row.priceBasis},${row.priceSource}) on conflict ("priceListId","supplierPartId") do nothing returning id`;
        entries += inserted.length;
      }
      for (const correction of manifest.aliasCorrections ?? [])
        for (const alias of correction.remove)
          await tx`delete from kublai_part_synonym where "partDefinitionId"=${correction.partDefinitionId} and lower(synonym)=lower(${alias})`;
      if (entries)
        await tx`update kublai_job_price_list set revision=revision+1,"updatedAt"=now() where id=${policy.id}`;
      const detail = {
        manifestHash: digest,
        reviewRevision: manifest.reviewRevision,
        rows: manifest.rows.length,
        created,
        aliases,
        listings,
        entries,
        estimatedPrices: true,
      };
      await tx`insert into kublai_job_pricing_audit (id,"organizationId","jobId",action,detail,"userId","actorUserId") values (${randomUUID()},${manifest.organizationId},${manifest.jobId},'reviewed_list_imported',${tx.json(detail)},${actor.id},${actor.id})`;
      return detail;
    });
    await fs.writeFile(
      path.join(folder, "result.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    console.log({ ...report, backupFolder: folder });
  }
} finally {
  await connection.end();
}
