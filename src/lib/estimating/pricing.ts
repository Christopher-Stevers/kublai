import type { EstimateLine, PricingRow, EstimatingSettings } from "./types";
import { normalizeDescription, normalizeUnit } from "./units";

/** Price identity must be exact. Similar words or incompatible units never select a price. */
export function matchEstimatePricing(
  lines: EstimateLine[],
  rows: PricingRow[],
  options: { currency?: EstimatingSettings["currency"] } = {},
) {
  const warnings: string[] = [];
  const ambiguous: { lineId: string; rowIds: string[] }[] = [];
  let matched = 0,
    unmatched = 0;
  // Index once per operation. Rebuilding here also keeps edits to the same
  // pricebook array visible; an identity-only cache could apply stale prices.
  const identities = new Map<
    string,
    { row: PricingRow; unit: string; supplier: string }[]
  >();
  if (lines.some((line) => line.reviewStatus !== "excluded")) {
    for (const row of rows) {
      const entry = {
        row,
        unit: normalizeUnit(row.unit),
        supplier: normalizeDescription(row.supplierName),
      };
      const description = normalizeDescription(row.description);
      const keys = [description];
      if (row.sku) {
        const sku = normalizeDescription(row.sku);
        // A row matching both its description and SKU was only one candidate
        // in the original scan. Distinct duplicate rows still stay ambiguous.
        if (sku !== description) keys.push(sku);
      }
      for (const key of keys) {
        const bucket = identities.get(key);
        if (bucket) bucket.push(entry);
        else identities.set(key, [entry]);
      }
    }
  }
  const pricedLines = lines.map((line) => {
    if (line.reviewStatus === "excluded") return line;
    const description = normalizeDescription(line.description);
    const identityMatches = identities.get(description) ?? [];
    const currency = options.currency ?? line.priceCurrency;
    const sameCurrency = identityMatches.filter(
      ({ row }) => !currency || !row.currency || row.currency === currency,
    );
    const unit = normalizeUnit(line.unit);
    const supplier = normalizeDescription(line.supplierName);
    const candidates = sameCurrency.filter(
      (entry) =>
        entry.unit === unit && (!supplier || entry.supplier === supplier),
    );
    if (!candidates.length) {
      unmatched++;
      if (identityMatches.length && !sameCurrency.length)
        warnings.push(
          `${line.description}: price currency differs from ${currency}; no currency conversion or price applied.`,
        );
      else if (identityMatches.length)
        warnings.push(
          `${line.description}: price candidates have a different unit or supplier; no price applied.`,
        );
      return line;
    }
    if (candidates.length > 1) {
      ambiguous.push({
        lineId: line.id,
        rowIds: candidates.map(({ row }) => row.id),
      });
      warnings.push(
        `${line.description}: ${candidates.length} exact price matches; choose a supplier/price row before applying pricing.`,
      );
      return line;
    }
    matched++;
    const { row } = candidates[0]!;
    return {
      ...line,
      materialUnitCost: row.materialUnitCost,
      laborHoursPerUnit: row.laborHoursPerUnit,
      equipmentUnitCost: row.equipmentUnitCost,
      subcontractUnitCost: row.subcontractUnitCost,
      otherUnitCost: row.otherUnitCost,
      orderMultiple: row.orderMultiple,
      supplierName: row.supplierName,
      trade: row.trade,
      costCode: row.costCode,
      priceSource:
        row.materialUnitCost === null
          ? ("missing" as const)
          : (row.priceSource ?? ("imported" as const)),
      priceUpdatedAt: row.updatedAt,
      priceCurrency: row.currency ?? currency,
      priceRowId: row.id,
    };
  });
  return { lines: pricedLines, warnings, matched, unmatched, ambiguous };
}
