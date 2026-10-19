import { sql } from "drizzle-orm";
import type { db } from "~/server/db";
import { recalculatePurchaseTotals } from "~/server/purchasing";

type Database = Pick<typeof db, "execute" | "select" | "update">;
// Serialize book maintenance before taking the same per-job locks used by order sending.
export async function lockPriceBooks(database: Pick<typeof db, "execute">) {
  await database.execute(sql`select pg_advisory_xact_lock(72491835)`);
}
export async function syncSupplierJobBook(
  database: Database,
  org: string,
  jobId: string,
  supplierId: string,
) {
  await database.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${org}:${jobId}:orders`}))`,
  );
  await database.execute(sql`insert into kublai_job_price_list (id,"organizationId","jobId",name,"requireApproval")
    values (gen_random_uuid(),${org},${jobId},'Job price books',false) on conflict ("jobId") do nothing`);
  // Restore standard prices before applying the selected book; never change sent snapshots.
  await database.execute(sql`update kublai_quote_item qi set "unitCost"=sp."lastKnownUnitCost","updatedAt"=now()
    from kublai_supplier_part sp,kublai_material_list ml
    where qi."quoteId"=ml."quoteId" and ml."jobId"=${jobId} and ml."organizationId"=${org}
      and qi."supplierPartId"=sp.id and sp."supplierId"=${supplierId} and sp."organizationId"=${org}
      and qi."sentOrderItemId" is null and (qi."supplierId" is null or qi."supplierId"=${supplierId})`);
  await database.execute(sql`delete from kublai_job_price_entry e using kublai_job_price_list l,kublai_supplier_part sp
    where e."priceListId"=l.id and l."jobId"=${jobId} and l."organizationId"=${org}
      and e."supplierPartId"=sp.id and sp."supplierId"=${supplierId}
      and not exists (select 1 from kublai_job_supplier_price_book j join kublai_supplier_price_book_entry b on b."bookId"=j."bookId"
        where j."jobId"=${jobId} and j."supplierId"=${supplierId} and b."supplierPartId"=sp.id)`);
  await database.execute(sql`insert into kublai_job_price_entry (id,"priceListId","supplierPartId","supplierPriceBookEntryId","unitCost","priceStatus","priceBasis","priceSource","sourceDescription",active)
    select gen_random_uuid(),l.id,e."supplierPartId",e.id,e."unitCost",e."priceStatus",e."priceBasis",e."priceSource",e."sourceDescription",true
    from kublai_job_price_list l join kublai_job_supplier_price_book j on j."jobId"=l."jobId"
    join kublai_supplier_price_book b on b.id=j."bookId" and b."organizationId"=l."organizationId" and b."supplierId"=j."supplierId"
    join kublai_supplier_price_book_entry e on e."bookId"=b.id
    join kublai_supplier_part sp on sp.id=e."supplierPartId" and sp."supplierId"=b."supplierId" and sp."organizationId"=b."organizationId"
    where l."jobId"=${jobId} and l."organizationId"=${org} and j."supplierId"=${supplierId}
    on conflict ("priceListId","supplierPartId") do update set "supplierPriceBookEntryId"=excluded."supplierPriceBookEntryId",
      "unitCost"=excluded."unitCost","priceStatus"=excluded."priceStatus","priceBasis"=excluded."priceBasis",
      "priceSource"=excluded."priceSource","sourceDescription"=excluded."sourceDescription",active=true,"updatedAt"=now()`);
  await database.execute(
    sql`update kublai_job_price_list set revision=revision+1,"updatedAt"=now() where "jobId"=${jobId} and "organizationId"=${org}`,
  );
  await database.execute(
    sql`update kublai_job_order_approval set status='superseded' where "jobId"=${jobId} and "organizationId"=${org} and status in ('pending','approved') and "usedAt" is null`,
  );
  const lists = await database.execute<{ id: string; quoteId: string | null }>(
    sql`select id,"quoteId" from kublai_material_list where "jobId"=${jobId} and "organizationId"=${org}`,
  );
  for (const list of lists)
    if (list.quoteId) await recalculatePurchaseTotals(database, list.quoteId);
  return [...lists];
}
export async function syncPriceBook(
  database: Database,
  org: string,
  bookId: string,
) {
  const jobs = await database.execute<{ jobId: string; supplierId: string }>(
    sql`select j."jobId",j."supplierId" from kublai_job_supplier_price_book j join kublai_supplier_price_book b on b.id=j."bookId" where b.id=${bookId} and b."organizationId"=${org} order by j."jobId"`,
  );
  const lists: { id: string; quoteId: string | null }[] = [];
  for (const job of jobs)
    lists.push(
      ...(await syncSupplierJobBook(database, org, job.jobId, job.supplierId)),
    );
  return lists;
}
