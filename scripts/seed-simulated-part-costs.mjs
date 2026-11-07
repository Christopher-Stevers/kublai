#!/usr/bin/env node
import "dotenv/config";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  estimatePartCost,
  estimateNote,
  SIMULATION_MARKER,
  SIMULATION_VERSION,
} from "./lib/simulated-part-cost.mjs";

const apply = process.argv.includes("--apply");
const unknown = process.argv.slice(2).filter((arg) => arg !== "--apply");
if (unknown.length)
  throw new Error(
    "Usage: node scripts/seed-simulated-part-costs.mjs [--apply]",
  );
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

function planPrices(data) {
  const partsById = new Map(data.parts.map((p) => [p.id, p]));
  const suppliersById = new Map(data.suppliers.map((s) => [s.id, s]));
  const listingsByPart = new Map();
  const legacyLinks = [];
  for (const row of data.listings) {
    if (
      partsById.get(row.partDefinitionId)?.organizationId !== row.organizationId
    )
      throw new Error(
        `Supplier listing has inconsistent organization: ${row.id}`,
      );
    if (
      suppliersById.get(row.supplierId)?.organizationId !== row.organizationId
    ) {
      if (positive(row.lastKnownUnitCost))
        throw new Error(
          `Priced supplier listing has inconsistent organization: ${row.id}`,
        );
      legacyLinks.push(row.id);
    }
    const group = listingsByPart.get(row.partDefinitionId) ?? [];
    group.push({ ...row });
    listingsByPart.set(row.partDefinitionId, group);
  }
  const estimates = new Map(
    data.parts.map((part) => [part.id, estimatePartCost(part)]),
  );
  const newSuppliers = [];
  const newListings = [];
  const updatedListings = [];
  const updatedItems = [];
  const touchedQuotes = new Set();
  const legacyItems = [];

  function defaultSupplier(part) {
    const existing = [...suppliersById.values()].filter(
      (s) => s.organizationId === part.organizationId && s.kind === "external",
    );
    const preferredName =
      part.catalog === "Hardware" ? "Fastening House" : "Next";
    const match =
      existing.find((s) => s.name === preferredName) ??
      existing.sort((a, b) => a.name.localeCompare(b.name))[0];
    if (match) return match;
    const row = {
      id: randomUUID(),
      organizationId: part.organizationId,
      name: "Simulation pricebook (CAD)",
      kind: "external",
      createdAt: new Date(),
      orderingNotes:
        "Simulation estimates only. No supplier quotation or ordering contact. Replace these costs with verified supplier prices.",
    };
    newSuppliers.push(row);
    suppliersById.set(row.id, row);
    return row;
  }

  function createListing(part, supplier) {
    const estimate = estimates.get(part.id);
    const group = listingsByPart.get(part.id) ?? [];
    const row = {
      id: randomUUID(),
      organizationId: part.organizationId,
      supplierId: supplier.id,
      partDefinitionId: part.id,
      lastKnownUnitCost: estimate.unitCost,
      currency: "CAD",
      isPreferred: group.length === 0,
      createdAt: new Date(),
      notes: estimateNote(estimate),
    };
    newListings.push(row);
    group.push(row);
    listingsByPart.set(part.id, group);
    return row;
  }

  // Some original demo fixtures reference another organization's supplier.
  // Keep the listing IDs and purchase rules, but give their estimates a local
  // pricebook rather than carrying that cross-organization reference forward.
  for (const id of legacyLinks) {
    const original = data.listings.find((row) => row.id === id);
    const part = partsById.get(original.partDefinitionId);
    const row = listingsByPart
      .get(part.id)
      .find((listing) => listing.id === id);
    row.supplierId = defaultSupplier(part).id;
  }

  for (const part of data.parts) {
    const group = listingsByPart.get(part.id) ?? [];
    if (!group.length) createListing(part, defaultSupplier(part));
    for (const row of group) {
      if (positive(row.lastKnownUnitCost)) continue;
      const estimate = estimates.get(part.id);
      row.lastKnownUnitCost = estimate.unitCost;
      row.currency = "CAD";
      row.notes = [row.notes, estimateNote(estimate)]
        .filter(Boolean)
        .join("\n");
      updatedListings.push({
        id: row.id,
        supplierId: row.supplierId,
        lastKnownUnitCost: row.lastKnownUnitCost,
        currency: row.currency,
        notes: row.notes,
      });
    }
  }

  const quotesById = new Map(data.quotes.map((q) => [q.id, q]));
  for (const item of data.items) {
    if (positive(item.unitCost)) continue;
    const quote = quotesById.get(item.quoteId);
    const part = partsById.get(item.partDefinitionId);
    if (!quote || !part)
      throw new Error(`Unpriced item cannot be resolved safely: ${item.id}`);
    if (quote.organizationId !== part.organizationId) {
      if (item.supplierPartId || item.supplierId)
        throw new Error(`Cross-organization supplier link on item ${item.id}`);
      // Original demo lines can point to another organization's catalog. Use
      // only our guessed model, without copying that organization's supplier
      // costs or creating any further cross-organization supplier links.
      const estimate = estimates.get(part.id);
      updatedItems.push({
        id: item.id,
        quoteId: item.quoteId,
        supplierPartId: null,
        supplierId: null,
        unitCost: estimate.unitCost,
        notes: [item.notes, estimateNote(estimate)].filter(Boolean).join("\n"),
      });
      touchedQuotes.add(item.quoteId);
      legacyItems.push(item.id);
      continue;
    }
    const group = listingsByPart.get(part.id);
    let listing = item.supplierPartId
      ? group.find((s) => s.id === item.supplierPartId)
      : null;
    if (item.supplierPartId && !listing)
      throw new Error(`Invalid supplier link on item ${item.id}`);
    if (!listing && item.supplierId) {
      const supplier = suppliersById.get(item.supplierId);
      if (!supplier || supplier.organizationId !== quote.organizationId)
        throw new Error(`Invalid supplier on item ${item.id}`);
      listing =
        group.find((s) => s.supplierId === supplier.id) ??
        createListing(part, supplier);
    }
    listing ??= group.find((s) => s.isPreferred) ?? group[0];
    const estimated = listing.notes?.includes(SIMULATION_MARKER);
    const notes = estimated
      ? [item.notes, estimateNote(estimates.get(part.id))]
          .filter(Boolean)
          .join("\n")
      : item.notes;
    updatedItems.push({
      id: item.id,
      quoteId: item.quoteId,
      supplierPartId: listing.id,
      supplierId: item.supplierId ?? listing.supplierId,
      unitCost: listing.lastKnownUnitCost,
      notes,
    });
    touchedQuotes.add(item.quoteId);
  }
  return {
    newSuppliers,
    newListings,
    updatedListings,
    updatedItems,
    touchedQuotes: [...touchedQuotes],
    estimates,
    legacyLinks,
    legacyItems,
  };
}

async function loadData(tx, lock) {
  const parts = await tx`
    select p.id, p."organizationId", p."displayName", p.description, p."sizeLabel", p."isActive",
      c.name catalog, m.name material, cat.name category, s.nominal, u.code "sizeUnit"
    from kublai_part_definition p
    join kublai_catalog c on c.id=p."catalogId"
    left join kublai_material m on m.id=p."materialId"
    left join kublai_category cat on cat.id=p."categoryId"
    left join kublai_size s on s.id=p."sizeId"
    left join kublai_unit u on u.id=s."unitId"
    order by p.id ${lock ? tx`for update of p` : tx``}
  `;
  const suppliers =
    await tx`select id,"organizationId",name,kind from kublai_supplier order by id`;
  const listings =
    await tx`select * from kublai_supplier_part order by id ${lock ? tx`for update` : tx``}`;
  const quotes =
    await tx`select * from kublai_quote order by id ${lock ? tx`for update` : tx``}`;
  const items =
    await tx`select * from kublai_quote_item order by id ${lock ? tx`for update` : tx``}`;
  return { parts, suppliers, listings, quotes, items };
}

try {
  const result = await sql.begin(async (tx) => {
    if (apply) {
      await tx`set local lock_timeout = '8s'`;
      await tx`set local statement_timeout = '30s'`;
      await tx`select pg_advisory_xact_lock(72491981)`;
    }
    const data = await loadData(tx, apply);
    const plan = planPrices(data);
    const summary = {
      mode: apply ? "apply" : "dry-run",
      version: SIMULATION_VERSION,
      catalogParts: data.parts.length,
      activeParts: data.parts.filter((p) => p.isActive).length,
      existingPricesPreserved: data.listings.filter((row) =>
        positive(row.lastKnownUnitCost),
      ).length,
      newSuppliers: plan.newSuppliers.length,
      legacySupplierLinksRepaired: plan.legacyLinks.length,
      legacyItemsPricedWithoutSupplierLinks: plan.legacyItems.length,
      newSupplierListings: plan.newListings.length,
      supplierPricesFilled: plan.updatedListings.length,
      materialListItemsFilled: plan.updatedItems.length,
      materialListQuotesRecalculated: plan.touchedQuotes.length,
      priceRange: {
        min: Math.min(
          ...[...plan.estimates.values()].map((e) => Number(e.unitCost)),
        ),
        max: Math.max(
          ...[...plan.estimates.values()].map((e) => Number(e.unitCost)),
        ),
      },
      assumptionCount: [...plan.estimates.values()].filter(
        (e) => e.warnings.length,
      ).length,
    };
    const outputDir = resolve(".tmp/simulated-pricing");
    mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const report = {
      ...summary,
      estimates: data.parts.map((p) => ({
        id: p.id,
        organizationId: p.organizationId,
        displayName: p.displayName,
        material: p.material,
        category: p.category,
        ...plan.estimates.get(p.id),
      })),
    };
    writeFileSync(
      resolve(
        outputDir,
        apply ? "applied-estimates.json" : "planned-estimates.json",
      ),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    if (!apply) return summary;
    if (
      !plan.newListings.length &&
      !plan.updatedListings.length &&
      !plan.updatedItems.length
    )
      return { ...summary, noChanges: true };

    const backupPath = resolve(
      outputDir,
      `backup-${Date.now()}-${randomUUID()}.json`,
    );
    const changedListingIds = new Set(plan.updatedListings.map((s) => s.id));
    const changedItemIds = new Set(plan.updatedItems.map((i) => i.id));
    const changedQuoteIds = new Set(plan.touchedQuotes);
    writeFileSync(
      backupPath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          version: SIMULATION_VERSION,
          newSupplierIds: plan.newSuppliers.map((s) => s.id),
          newListingIds: plan.newListings.map((s) => s.id),
          supplierParts: data.listings.filter((s) =>
            changedListingIds.has(s.id),
          ),
          quoteItems: data.items.filter((i) => changedItemIds.has(i.id)),
          quotes: data.quotes.filter((q) => changedQuoteIds.has(q.id)),
          materialLists: plan.touchedQuotes.length
            ? await tx`select id,"quoteId","updatedAt" from kublai_material_list where "quoteId" in ${tx(plan.touchedQuotes)}`
            : [],
          // Kept with the backup so a subsequent price edit can be distinguished
          // from this operation when preparing a selective rollback.
          appliedSupplierParts: [...plan.updatedListings, ...plan.newListings],
          appliedQuoteItems: plan.updatedItems,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );

    if (plan.newSuppliers.length)
      await tx`insert into kublai_supplier ${tx(plan.newSuppliers, "id", "organizationId", "name", "kind", "orderingNotes", "createdAt")} returning id`;
    if (plan.newListings.length)
      await tx`insert into kublai_supplier_part ${tx(plan.newListings, "id", "organizationId", "supplierId", "partDefinitionId", "lastKnownUnitCost", "currency", "isPreferred", "notes", "createdAt")} returning id`;
    if (plan.updatedListings.length)
      await tx`
      update kublai_supplier_part sp set "lastKnownUnitCost"=p.cost, "supplierId"=p.supplier, currency=p.currency, notes=p.notes
      from jsonb_to_recordset(${tx.json(plan.updatedListings.map((s) => ({ id: s.id, supplier: s.supplierId, cost: s.lastKnownUnitCost, currency: s.currency, notes: s.notes })))}) as p(id uuid,supplier uuid,cost numeric,currency text,notes text)
      where sp.id=p.id and (sp."lastKnownUnitCost" is null or sp."lastKnownUnitCost"<=0)
    `;
    if (plan.updatedItems.length)
      await tx`
      update kublai_quote_item qi set "unitCost"=p.cost, "supplierPartId"=p.listing,
        "supplierId"=p.supplier, notes=p.notes, "updatedAt"=now()
      from jsonb_to_recordset(${tx.json(plan.updatedItems.map((i) => ({ id: i.id, cost: i.unitCost, listing: i.supplierPartId, supplier: i.supplierId, notes: i.notes })))}) as p(id uuid,cost numeric,listing uuid,supplier uuid,notes text)
      where qi.id=p.id and (qi."unitCost" is null or qi."unitCost"<=0)
    `;
    if (plan.touchedQuotes.length) {
      // The same base-unit, supplier-multiple and cent-rounding calculation as
      // src/lib/purchase-quantity.ts and src/server/purchasing.ts.
      await tx`
        update kublai_quote_item qi set "extendedPrice"=round(
          case when qi.quantity<=0 then 0
            when sp."packSize">0 then ceil(qi.quantity/sp."packSize")*sp."packSize"
            else qi.quantity end * coalesce(qi."unitCost",0), 2), "updatedAt"=now()
        from kublai_quote_item original left join kublai_supplier_part sp on sp.id=original."supplierPartId"
        where qi.id=original.id and qi."quoteId" in ${tx(plan.touchedQuotes)}
      `;
      await tx`
        update kublai_quote q set "subtotalMaterials"=p.subtotal,
          total=round(p.subtotal*(1+coalesce(q."markupPercent",0)/100),2)
        from (select "quoteId",sum(coalesce("extendedPrice",0)) subtotal from kublai_quote_item where "quoteId" in ${tx(plan.touchedQuotes)} group by "quoteId") p
        where q.id=p."quoteId"
      `;
      await tx`update kublai_material_list set "updatedAt"=now() where "quoteId" in ${tx(plan.touchedQuotes)}`;
    }
    const [verification] = await tx`
      select
        (select count(*)::int from kublai_part_definition p where not exists(select 1 from kublai_supplier_part sp where sp."partDefinitionId"=p.id and sp."organizationId"=p."organizationId" and sp."lastKnownUnitCost">0)) as unpriced_parts,
        (select count(*)::int from kublai_supplier_part where "lastKnownUnitCost" is null or "lastKnownUnitCost"<=0) as unpriced_listings,
        (select count(*)::int from kublai_quote_item where "unitCost" is null or "unitCost"<=0) as unpriced_material_list_items,
        (select count(*)::int from kublai_supplier_part sp join kublai_part_definition p on p.id=sp."partDefinitionId" join kublai_supplier s on s.id=sp."supplierId" where p."organizationId"<>sp."organizationId" or s."organizationId"<>sp."organizationId") as invalid_supplier_organizations
    `;
    if (Object.values(verification).some((value) => value !== 0))
      throw new Error(
        `Coverage verification failed: ${JSON.stringify(verification)}`,
      );
    return { ...summary, backupPath, verification };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
