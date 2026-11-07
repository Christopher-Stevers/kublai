import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { db } from "~/server/db";
import {
  jobSupplierDefaultsSchema,
  matchJobSupplierDefault,
  type JobSupplierDefaults,
  type SupplierVersion,
  type SupplierDefaultPart,
} from "~/lib/job-supplier-defaults";
type Reader = Pick<typeof db, "execute">;
export async function validateJobSupplierDefaults(
  database: Reader,
  org: string,
  config: JobSupplierDefaults,
) {
  jobSupplierDefaultsSchema.parse(config);
  for (const version of [
    ...config.rules.map((rule) => rule.supplier),
    ...(config.fallback ? [config.fallback] : []),
  ]) {
    const rows =
      await database.execute(sql`select s.id from kublai_supplier s where s.id=${version.supplierId} and s."organizationId"=${org} and coalesce(s.kind,'supplier') <> 'tool_room'
      and (${version.bookId}::uuid is null or exists(select 1 from kublai_supplier_price_book b where b.id=${version.bookId} and b."supplierId"=s.id and b."organizationId"=${org}))`);
    if (!rows.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A selected supplier version is no longer available.",
      });
  }
  for (const rule of config.rules) {
    for (const [table, id] of [
      ["kublai_catalog", rule.catalogId],
      ["kublai_material", rule.materialId],
      ["kublai_category", rule.categoryId],
    ] as const) {
      if (!id) continue;
      const rows = await database.execute(
        sql`select id from ${sql.identifier(table)} where id=${id} and "organizationId"=${org}`,
      );
      if (!rows.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A supplier rule filter is outside this organization.",
        });
    }
  }
}
export async function resolveDefaultSupplier(
  database: Reader,
  org: string,
  jobId: string,
  partId: string,
) {
  const [job] = await database.execute<{ config: JobSupplierDefaults | null }>(
    sql`select "supplierDefaults" config from kublai_job where id=${jobId} and "organizationId"=${org}`,
  );
  if (!job?.config) return null;
  const [part] = await database.execute<
    SupplierDefaultPart & { kind: string }
  >(sql`select p."catalogId",p."materialId",p."categoryId",s.nominal as "sizeNominal",u.code as "sizeUnit",p."sizeLabel",c.kind
    from kublai_part_definition p join kublai_catalog c on c.id=p."catalogId" left join kublai_size s on s.id=p."sizeId" left join kublai_unit u on u.id=s."unitId" where p.id=${partId} and p."organizationId"=${org} and p."isActive"=true`);
  if (!part || part.kind === "assets") return null;
  const version = matchJobSupplierDefault(
    jobSupplierDefaultsSchema.parse(job.config),
    part,
  );
  return version;
}
export async function supplierVersionPrice(
  database: Reader,
  org: string,
  version: SupplierVersion,
  partId: string,
  listingId?: string | null,
) {
  const [supplier] = await database.execute<{ name: string }>(
    sql`select name from kublai_supplier where id=${version.supplierId} and "organizationId"=${org} and coalesce(kind,'external') <> 'tool_room'`,
  );
  if (!supplier)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Default supplier is unavailable.",
    });
  let bookName = "Standard";
  if (version.bookId) {
    const [book] = await database.execute<{ name: string }>(
      sql`select name from kublai_supplier_price_book where id=${version.bookId} and "supplierId"=${version.supplierId} and "organizationId"=${org}`,
    );
    if (!book)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "The selected supplier version is unavailable. Choose another supplier.",
      });
    bookName = book.name;
  }
  const [listing] = await database.execute<{
    id: string;
    unitCost: string | null;
    supplierSku: string | null;
    packSize: string | null;
  }>(sql`select sp.id,sp."supplierSku",sp."packSize",${version.bookId ? sql`e."unitCost"` : sql`sp."lastKnownUnitCost"`} as "unitCost"
    from kublai_supplier_part sp left join kublai_supplier_price_book_entry e on e."supplierPartId"=sp.id and e."bookId"=${version.bookId}
    where sp."organizationId"=${org} and sp."supplierId"=${version.supplierId} and sp."partDefinitionId"=${partId}
    order by (sp.id=${listingId ?? null}) desc nulls last,${version.bookId ? sql`(e.id is not null) desc,` : sql``}sp."isPreferred" desc,sp.id limit 1`);
  return {
    supplierName: supplier.name,
    bookName,
    listing,
    unitCost: listing?.unitCost ?? null,
  };
}
