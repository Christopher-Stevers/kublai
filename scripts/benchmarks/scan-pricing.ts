// Frozen pre-index implementation for equivalent-result performance comparisons.
import type {
  EstimateLine,
  PricingRow,
  EstimatingSettings,
} from "../../src/lib/estimating/types";
import {
  normalizeDescription,
  normalizeUnit,
} from "../../src/lib/estimating/units";

/** Price identity must be exact. Similar words or incompatible units never select a price. */
export function scanEstimatePricing(
  lines: EstimateLine[],
  rows: PricingRow[],
  options: { currency?: EstimatingSettings["currency"] } = {},
) {
  const warnings: string[] = [];
  const ambiguous: { lineId: string; rowIds: string[] }[] = [];
  let matched = 0,
    unmatched = 0;
  const pricedLines = lines.map((line) => {
    if (line.reviewStatus === "excluded") return line;
    const description = normalizeDescription(line.description);
    const identityMatches = rows.filter(
      (row) =>
        normalizeDescription(row.description) === description ||
        (row.sku && normalizeDescription(row.sku) === description),
    );
    const currency = options.currency ?? line.priceCurrency;
    const sameCurrency = identityMatches.filter(
      (row) => !currency || !row.currency || row.currency === currency,
    );
    const candidates = sameCurrency.filter(
      (row) =>
        normalizeUnit(row.unit) === normalizeUnit(line.unit) &&
        (!line.supplierName.trim() ||
          normalizeDescription(row.supplierName) ===
            normalizeDescription(line.supplierName)),
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
        rowIds: candidates.map((row) => row.id),
      });
      warnings.push(
        `${line.description}: ${candidates.length} exact price matches; choose a supplier/price row before applying pricing.`,
      );
      return line;
    }
    matched++;
    const row = candidates[0]!;
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
