// Apply an explicitly reviewed set of existing supplier listings to one job.
// Approval of the supplier/parts never confirms the estimated dollar amounts.
import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const file = process.argv[2];
assert(
  file,
  "Usage: node scripts/ops/approve-job-catalogue-supplier.mjs manifest.json [--apply]",
);
const raw = await fs.readFile(file, "utf8");
const manifest = JSON.parse(raw);
const apply = process.argv.includes("--apply");
const hash = createHash("sha256").update(raw).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
assert.equal(manifest.version, 1);
for (const key of ["organizationId", "jobId", "catalogId", "supplierId"])
  assert(uuid.test(manifest[key]), `Invalid ${key}`);
assert(manifest.actorUserId && manifest.authorization);
assert(Number.isInteger(manifest.expectedRevision));
assert(
  Array.isArray(manifest.rows) &&
    manifest.rows.length > 0 &&
    manifest.rows.length <= 1000,
);
assert.equal(
  new Set(manifest.rows.map((r) => r.supplierPartId)).size,
  manifest.rows.length,
);
assert.equal(
  new Set(manifest.rows.map((r) => r.partDefinitionId)).size,
  manifest.rows.length,
);
for (const row of manifest.rows) {
  assert(uuid.test(row.supplierPartId) && uuid.test(row.partDefinitionId));
  assert(
    /^\d{1,8}(?:\.\d{1,4})?$/.test(row.unitCost) && Number(row.unitCost) > 0,
  );
  assert.equal(row.priceStatus, "estimated");
  assert(row.priceBasis?.length > 0 && row.priceBasis.length <= 100);
  assert(row.priceSource?.length > 0);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const report = await sql.begin(async (tx) => {
    await tx`set local lock_timeout='5s'`;
    await tx`set local statement_timeout='120s'`;
    await tx`select pg_advisory_xact_lock(hashtext(${`${manifest.organizationId}:${manifest.jobId}:orders`}))`;
    const [scope] = await tx`
      select l.*, j.name as "jobName", c.name as "catalogName", s.name as "supplierName"
      from kublai_job_price_list l
      join kublai_job j on j.id=l."jobId" and j."organizationId"=l."organizationId"
      join kublai_catalog c on c.id=${manifest.catalogId} and c."organizationId"=l."organizationId"
      join kublai_supplier s on s.id=${manifest.supplierId} and s."organizationId"=l."organizationId"
      where l."jobId"=${manifest.jobId} and l."organizationId"=${manifest.organizationId} for update of l`;
    assert(
      scope?.active && scope.requireApproval,
      "Expected active job policy with unlisted-order approval",
    );
    assert.equal(
      scope.revision,
      manifest.expectedRevision,
      "Price list changed; review a fresh manifest",
    );
    assert.equal(scope.name, manifest.expectedName, "Price-list name changed");
    const [actor] =
      await tx`select id from kublai_user where id=${manifest.actorUserId} and "organizationId"=${manifest.organizationId}`;
    assert(actor, "Audit actor must belong to the job organization");
    const listings = await tx`
      select sp.*, p."piecesPerPack", p."bulkUnit", p."individualUnit", p."displayName"
      from kublai_supplier_part sp join kublai_part_definition p on p.id=sp."partDefinitionId"
      where sp.id in ${tx(manifest.rows.map((r) => r.supplierPartId))}
        and sp."organizationId"=${manifest.organizationId} and sp."supplierId"=${manifest.supplierId}
        and p."organizationId"=${manifest.organizationId} and p."catalogId"=${manifest.catalogId} and p."isActive"
      for share of sp,p`;
    const byId = new Map(listings.map((r) => [r.id, r]));
    for (const row of manifest.rows) {
      const listing = byId.get(row.supplierPartId);
      assert.equal(
        listing?.partDefinitionId,
        row.partDefinitionId,
        "Supplier listing moved or left the selected catalogue",
      );
      assert.equal(
        listing.piecesPerPack,
        row.piecesPerPack,
        "Pack contents changed",
      );
      assert.equal(listing.bulkUnit, row.bulkUnit, "Bulk unit changed");
      assert.equal(
        listing.individualUnit,
        row.individualUnit,
        "Individual unit changed",
      );
      assert.equal(listing.currency, "CAD", "Unexpected supplier currency");
      assert.equal(
        Number(listing.lastKnownUnitCost),
        Number(row.seedUnitCost),
        "Catalogue allowance changed",
      );
    }
    const before = {
      policy: scope,
      entries:
        await tx`select * from kublai_job_price_entry where "priceListId"=${scope.id}`,
      approvals:
        await tx`select * from kublai_job_order_approval where "jobId"=${manifest.jobId} and "organizationId"=${manifest.organizationId}`,
    };
    const present = new Set(before.entries.map((r) => r.supplierPartId));
    const rows = manifest.rows.filter((r) => !present.has(r.supplierPartId));
    const result = {
      mode: apply ? "apply" : "validate",
      job: scope.jobName,
      supplier: scope.supplierName,
      parts: manifest.rows.length,
      newEntries: rows.length,
      preservedEntries: manifest.rows.length - rows.length,
      packPrices: rows.filter((r) => r.piecesPerPack > 1).length,
      manifestHash: hash,
    };
    if (!apply || !rows.length) return result;
    const folder = path.join(
      process.env.HOME,
      ".local/share/foremanhq-import-backups",
      `job-catalogue-supplier-${Date.now()}`,
    );
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      path.join(folder, "before.json"),
      JSON.stringify(before),
      { mode: 0o600 },
    );
    await fs.writeFile(path.join(folder, "manifest.json"), raw, {
      mode: 0o600,
    });
    for (const row of rows)
      await tx`
        insert into kublai_job_price_entry (id,"priceListId","supplierPartId","unitCost","priceStatus","priceBasis","priceSource")
        values (${randomUUID()},${scope.id},${row.supplierPartId},${row.unitCost},'estimated',${row.priceBasis},${row.priceSource})`;
    await tx`update kublai_job_price_list set name=${manifest.name}, revision=revision+1,"updatedAt"=now() where id=${scope.id}`;
    await tx`
      update kublai_job_order_approval set status='superseded'
      where "jobId"=${manifest.jobId} and "organizationId"=${manifest.organizationId}
        and status in ('pending','approved') and "usedAt" is null`;
    await tx`
      insert into kublai_job_pricing_audit (id,"organizationId","jobId",action,detail,"userId","actorUserId")
      values (${randomUUID()},${manifest.organizationId},${manifest.jobId},'catalogue_supplier_approved',
        ${tx.json({ ...result, authorization: manifest.authorization, supplierId: manifest.supplierId, catalogId: manifest.catalogId, supplierPartIds: rows.map((r) => r.supplierPartId), confirmedPrices: false })},
        ${actor.id},${actor.id})`;
    return { ...result, backupFolder: folder };
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await sql.end();
}
