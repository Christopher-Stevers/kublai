// Consolidate Next (Alma) into Next, retaining canonical parts and immutable order prices.
// Dry-run by default. Apply schema migration 0082 before --apply.
import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
const org = "0ff8da19-703c-4aea-ba1d-70a6384e1f9b",
  job = "0391aed4-7773-47ec-9141-09df373ec008";
const next = "feeb0f72-7fe4-4b14-9044-81fea8e92100",
  clone = "3ed92a3e-e82b-4493-98c1-45afc14a4284",
  fastening = "29f9ce39-273f-4711-af50-8ba4d889dd53";
const apply = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  console.log(
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(72491835)`;
      await tx`select pg_advisory_xact_lock(hashtext(${`${org}:${job}:orders`}))`;
      const suppliers =
        await tx`select * from kublai_supplier where "organizationId"=${org} and id in (${next},${clone},${fastening})`;
      if (
        !suppliers.find((s) => s.id === next && s.name === "Next") ||
        !suppliers.find(
          (s) => s.id === fastening && s.name === "Fastening House",
        )
      )
        throw Error("Unexpected suppliers");
      const [policy] =
        await tx`select * from kublai_job_price_list where "jobId"=${job} and "organizationId"=${org} for update`;
      if (!policy) throw Error("Missing Alma policy");
      const listings =
        await tx`select * from kublai_supplier_part where "organizationId"=${org} and "supplierId" in (${next},${clone},${fastening})`;
      const entries =
        await tx`select * from kublai_job_price_entry where "priceListId"=${policy.id}`;
      const mappings = listings
        .filter((p) => p.supplierId === clone)
        .map((old) => {
          const original = listings.find(
            (p) =>
              p.supplierId === next &&
              p.supplierSku === old.supplierSku &&
              p.partDefinitionId === old.partDefinitionId,
          );
          if (!original) throw Error("Missing original listing");
          return { old: old.id, id: original.id };
        });
      const nextListings = entries
        .map((e) => listings.find((p) => p.id === e.supplierPartId))
        .filter((p) => p && (p.supplierId === next || p.supplierId === clone));
      if (nextListings.length !== 728)
        throw Error("Next must have 728 Alma entries");
      const hardware = listings.filter((p) => p.supplierId === fastening);
      const report = {
        consolidateNextListings: mappings.length,
        nextAlma: 728,
        fasteningHouseAlma: hardware.length,
      };
      if (!apply) return { mode: "dry-run", ...report };
      const before = { suppliers, listings, entries, policy, related: {} };
      // Back up affected reference rows before rewiring. Sent costs/quantities are never written.
      const refs =
        await tx`select conrelid::regclass::text as tbl,a.attname as col,confrelid::regclass::text as ref from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey) where c.contype='f' and c.confrelid in ('kublai_supplier'::regclass,'kublai_supplier_part'::regclass)`;
      for (const r of refs) {
        const ids =
          r.ref === "kublai_supplier" ? [clone] : mappings.map((m) => m.old);
        if (ids.length)
          before.related[r.tbl + "." + r.col] =
            await tx`select * from ${tx(r.tbl)} where ${tx(r.col)} in ${tx(ids)}`;
      }
      const folder = path.join(
        os.homedir(),
        ".local/share/foremanhq-import-backups",
        `supplier-price-books-${Date.now()}`,
      );
      await fs.mkdir(folder, { recursive: true, mode: 0o700 });
      await fs.writeFile(
        path.join(folder, "before.json"),
        JSON.stringify(before, null, 2),
        { mode: 0o600 },
      );
      // Delete only redundant junction/preferences; retain original Next settings when both exist.
      await tx`delete from kublai_supplier_email_preference c using kublai_supplier_email_preference n where c."supplierId"=${clone} and n."supplierId"=${next} and c."userId"=n."userId"`;
      await tx`delete from kublai_job_supplier c using kublai_job_supplier n where c."supplierId"=${clone} and n."supplierId"=${next} and c."jobId"=n."jobId"`;
      for (const r of refs) {
        if (r.ref === "kublai_supplier_part") {
          for (const m of mappings)
            await tx`update ${tx(r.tbl)} set ${tx(r.col)}=${m.id} where ${tx(r.col)}=${m.old}`;
        } else if (r.tbl !== "kublai_supplier_part")
          await tx`update ${tx(r.tbl)} set ${tx(r.col)}=${next} where ${tx(r.col)}=${clone}`;
      }
      if (mappings.length)
        await tx`delete from kublai_supplier_part where "supplierId"=${clone} and "organizationId"=${org}`;
      await tx`delete from kublai_supplier where id=${clone} and "organizationId"=${org}`;
      for (const supplierId of [next, fastening]) {
        const [b] =
          await tx`insert into kublai_supplier_price_book (id,"organizationId","supplierId",name) values (${randomUUID()},${org},${supplierId},'Alma') on conflict ("supplierId",name) do update set name=excluded.name returning *`;
        const sourceRows =
          supplierId === next
            ? nextListings.map((p) =>
                listings.find(
                  (x) =>
                    x.id === (mappings.find((m) => m.old === p.id)?.id ?? p.id),
                ),
              )
            : hardware;
        for (const p of sourceRows) {
          const e = entries.find(
            (e) =>
              (mappings.find((m) => m.old === e.supplierPartId)?.id ??
                e.supplierPartId) === p.id,
          );
          const cost = e ? e.unitCost : p.lastKnownUnitCost;
          const status =
            e?.priceStatus ?? (cost === null ? "none" : "estimated");
          const [be] =
            await tx`insert into kublai_supplier_price_book_entry (id,"bookId","supplierPartId","unitCost","priceStatus","priceBasis","priceSource","sourceDescription") values (${randomUUID()},${b.id},${p.id},${cost},${status},${e?.priceBasis ?? "each"},${e?.priceSource ?? "Copied from standard supplier pricing; not a confirmed quote"},${e?.sourceDescription ?? p.supplierName}) on conflict ("bookId","supplierPartId") do update set "bookId"=excluded."bookId" returning *`;
          await tx`insert into kublai_job_price_entry (id,"priceListId","supplierPartId","supplierPriceBookEntryId","unitCost","priceStatus","priceBasis","priceSource","sourceDescription",active) values (${e?.id ?? randomUUID()},${policy.id},${p.id},${be.id},${be.unitCost},${be.priceStatus},${be.priceBasis},${be.priceSource},${be.sourceDescription},true) on conflict ("priceListId","supplierPartId") do update set "supplierPriceBookEntryId"=excluded."supplierPriceBookEntryId","unitCost"=excluded."unitCost","priceStatus"=excluded."priceStatus",active=true,"updatedAt"=now()`;
        }
        await tx`insert into kublai_job_supplier_price_book (id,"jobId","supplierId","bookId") values (${randomUUID()},${job},${supplierId},${b.id}) on conflict ("jobId","supplierId") do update set "bookId"=excluded."bookId"`;
      }
      await tx`update kublai_job_price_list set revision=revision+1,"updatedAt"=now() where id=${policy.id}`;
      await tx`update kublai_job_order_approval set status='superseded' where "organizationId"=${org} and "jobId"=${job} and "usedAt" is null and status in ('pending','approved')`;
      await tx`insert into kublai_job_pricing_audit (id,"organizationId","jobId",action,detail) values (${randomUUID()},${org},${job},'supplier_price_books_migration',${tx.json(report)})`;
      return { mode: "applied", ...report, backup: folder };
    }),
  );
} finally {
  await sql.end();
}
