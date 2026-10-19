// Merge only unambiguous legacy generic Next listings into their Alma SKU listing.
// Dry-run by default. Prices and immutable order snapshots are preserved.
import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
const org = "0ff8da19-703c-4aea-ba1d-70a6384e1f9b",
  supplier = "feeb0f72-7fe4-4b14-9044-81fea8e92100";
const apply = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  console.log(
    JSON.stringify(
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(72491835)`;
        await tx`set local lock_timeout='10s'`;
        // Block competing imports, edits and inserts while rewiring supplier references.
        await tx`lock table kublai_supplier_part in share row exclusive mode`;
        const rows =
          await tx`select sp.*,p."displayName" from kublai_supplier_part sp join kublai_part_definition p on p.id=sp."partDefinitionId" where sp."organizationId"=${org} and sp."supplierId"=${supplier}`;
        const books =
          await tx`select e.* from kublai_supplier_price_book_entry e join kublai_supplier_price_book b on b.id=e."bookId" where b."organizationId"=${org} and b."supplierId"=${supplier}`;
        const jobEntries =
          await tx`select e.* from kublai_job_price_entry e join kublai_supplier_part p on p.id=e."supplierPartId" where p."organizationId"=${org} and p."supplierId"=${supplier}`;
        const groups = new Map();
        for (const r of rows) {
          const a = groups.get(r.partDefinitionId) ?? [];
          a.push(r);
          groups.set(r.partDefinitionId, a);
        }
        const plan = [],
          skipped = [];
        for (const [partId, group] of groups) {
          if (group.length < 2) continue;
          const blanks = group.filter((r) => !r.supplierSku?.trim()),
            skus = group.filter((r) => r.supplierSku?.trim());
          let reason;
          if (group.length !== 2 || blanks.length !== 1 || skus.length !== 1)
            reason = "Multiple SKU or generic records require separate review";
          else {
            const old = blanks[0],
              keep = skus[0];
            if (!books.some((e) => e.supplierPartId === keep.id))
              reason = "SKU listing is not in a price book";
            else if (
              books.some((e) => e.supplierPartId === old.id) ||
              jobEntries.some((e) => e.supplierPartId === old.id)
            )
              reason = "Generic listing has separate book pricing";
            else if (
              old.currency !== keep.currency ||
              Number(old.packSize ?? 1) !== Number(keep.packSize ?? 1) ||
              old.packUomId !== keep.packUomId
            )
              reason = "Currency or packaging differs";
            else if (
              keep.lastKnownUnitCost !== null &&
              old.lastKnownUnitCost !== null &&
              Number(keep.lastKnownUnitCost) !== Number(old.lastKnownUnitCost)
            )
              reason = "Conflicting standard prices";
            else if (
              old.supplierName &&
              old.supplierName !== keep.supplierName &&
              old.supplierName !== old.displayName
            )
              reason = "Conflicting supplier descriptions";
            else plan.push({ old, keep });
          }
          if (reason)
            skipped.push({
              partId,
              reason,
              skus: group.map((r) => r.supplierSku),
            });
        }
        const report = {
          mode: apply ? "applied" : "dry-run",
          mergeCount: plan.length,
          skipped,
        };
        if (!apply) return report;
        const refs =
          await tx`select conrelid::regclass::text tbl,a.attname col from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey) where c.contype='f' and c.confrelid='kublai_supplier_part'::regclass`;
        const oldIds = plan.map((p) => p.old.id);
        if (!oldIds.length) return report;
        const before = { plan, books, jobEntries, related: {} };
        for (const r of refs)
          before.related[r.tbl + "." + r.col] =
            await tx`select * from ${tx(r.tbl)} where ${tx(r.col)} in ${tx(oldIds)}`;
        const backup = path.join(
          os.homedir(),
          ".local/share/foremanhq-import-backups",
          `next-listing-dedup-${Date.now()}`,
        );
        await fs.mkdir(backup, { recursive: true, mode: 0o700 });
        await fs.writeFile(
          path.join(backup, "before.json"),
          JSON.stringify(before, null, 2),
          { mode: 0o600 },
        );
        for (const { old, keep } of plan) {
          for (const r of refs)
            await tx`update ${tx(r.tbl)} set ${tx(r.col)}=${keep.id} where ${tx(r.col)}=${old.id}`;
          await tx`update kublai_supplier_part set "lastKnownUnitCost"=${keep.lastKnownUnitCost ?? old.lastKnownUnitCost},"isPreferred"=${keep.isPreferred || old.isPreferred},notes=${[keep.notes, old.notes].filter(Boolean).join("\n\n")} where id=${keep.id}`;
          await tx`delete from kublai_supplier_part where id=${old.id}`;
        }
        const afterBooks =
          await tx`select e.* from kublai_supplier_price_book_entry e join kublai_supplier_price_book b on b.id=e."bookId" where b."organizationId"=${org} and b."supplierId"=${supplier}`;
        const stable = (a) =>
          JSON.stringify([...a].sort((a, b) => a.id.localeCompare(b.id)));
        if (stable(books) !== stable(afterBooks))
          throw Error("Book entries changed unexpectedly");
        // Verify all references retained their values except the supplier listing FK.
        for (const r of refs) {
          const prior = before.related[r.tbl + "." + r.col];
          if (!prior.length) continue;
          const after =
            await tx`select * from ${tx(r.tbl)} where id in ${tx(prior.map((row) => row.id))}`;
          const map = new Map(plan.map((p) => [p.old.id, p.keep.id]));
          const expected = prior.map((row) => ({
            ...row,
            [r.col]: map.get(row[r.col]),
          }));
          if (stable(expected) !== stable(after))
            throw Error(`Unexpected changes to ${r.tbl}`);
        }
        return { ...report, backup };
      }),
      null,
      2,
    ),
  );
} finally {
  await sql.end();
}
