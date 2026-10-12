import type {
  EstimateDocument,
  EstimateLine,
  EstimatingSettings,
} from "./types";
import {
  add,
  applyPercent,
  decimal,
  divide,
  multiply,
  numeric,
  roundInteger,
  roundUpMultiple,
  safeCents,
  type Decimal,
} from "./decimal";
import { normalizeDescription, normalizeUnit } from "./units";

export type EstimateWarning = {
  code: string;
  message: string;
  lineId?: string;
  severity: "warning" | "error";
};
export type EstimateTotals = {
  materialTotal: number;
  laborHours: number;
  laborTotal: number;
  equipmentTotal: number;
  subcontractTotal: number;
  otherTotal: number;
  directCost: number;
  overhead: number;
  contingency: number;
  profit: number;
  subtotal: number;
  tax: number;
  total: number;
  cents: Omit<EstimateTotals, "cents" | "laborHours">;
};
export type CalculatedEstimateLine = EstimateLine & {
  demand: number;
  requiredQuantity: number;
  purchaseQuantity: number;
  materialTotal: number;
  laborHours: number;
  laborTotal: number;
  equipmentTotal: number;
  subcontractTotal: number;
  otherTotal: number;
  directCost: number;
  included: boolean;
  warnings: string[];
};
type WorkingLine = {
  line: EstimateLine;
  demand: Decimal;
  required: Decimal;
  purchase: Decimal;
  materialCents: number;
  laborHours: Decimal;
  laborCents: number;
  equipmentCents: number;
  subcontractCents: number;
  otherCents: number;
};
const money = (cents: number) => cents / 100;
const valid = (v: number) => Number.isFinite(v) && v >= 0;
const inferredKinds = new Set([
  "drawing-measurement",
  "drawing-schedule",
  "room",
  "ai",
]);

/** Stable evidence identity: separate assemblies/material rows remain billable; the same drawing import does not. */
export function estimateSourceKey(line: EstimateLine): string | null {
  const source = line.source;
  if (
    source.kind === "drawing-measurement" &&
    source.sheetId &&
    source.markupId
  )
    return `${source.kind}:${source.sheetId}:${source.markupId}`;
  if (source.kind === "drawing-schedule" && source.sheetId && source.markupId)
    return `${source.kind}:${source.sheetId}:${source.markupId}`;
  if (source.kind === "room" && source.floorId && source.markupId)
    return `${source.kind}:${source.floorId}:${source.markupId}`;
  return null;
}

function calculateRows(
  lines: EstimateLine[],
  settings: EstimatingSettings,
  prepared: Map<EstimateLine, WorkingLine>,
) {
  const rows: WorkingLine[] = lines.map((line) => {
    const cached = prepared.get(line);
    if (cached) return { ...cached };
    const demand = multiply(decimal(line.quantity), decimal(line.multiplier));
    const required = multiply(
      demand,
      add(decimal(1), divide(decimal(line.wastePercent), decimal(100))),
    );
    const laborHours = multiply(
      multiply(demand, decimal(line.laborHoursPerUnit)),
      decimal(settings.productivityFactor),
    );
    const rate = line.laborRate ?? settings.laborRate;
    const burdenedRate = multiply(
      decimal(rate),
      add(
        decimal(1),
        divide(decimal(settings.laborBurdenPercent), decimal(100)),
      ),
    );
    const initial: WorkingLine = {
      line,
      demand,
      required,
      purchase: required,
      materialCents: 0,
      laborHours,
      laborCents: safeCents(
        roundInteger(
          multiply(multiply(laborHours, burdenedRate), decimal(100)),
        ),
      ),
      equipmentCents: safeCents(
        roundInteger(
          multiply(
            multiply(demand, decimal(line.equipmentUnitCost)),
            decimal(100),
          ),
        ),
      ),
      subcontractCents: safeCents(
        roundInteger(
          multiply(
            multiply(demand, decimal(line.subcontractUnitCost)),
            decimal(100),
          ),
        ),
      ),
      otherCents: safeCents(
        roundInteger(
          multiply(multiply(demand, decimal(line.otherUnitCost)), decimal(100)),
        ),
      ),
    };
    // Purchase rounding is specific to the selected group. Reuse only the
    // unallocated arithmetic, and give each option its own mutable row.
    prepared.set(line, initial);
    return { ...initial };
  });
  const groups = new Map<string, WorkingLine[]>();
  for (const row of rows) {
    // Exact uploaded pricebook matches establish a shared purchasable item; arbitrary manual names do not.
    const identity =
      row.line.supplierPartId ??
      row.line.partDefinitionId ??
      row.line.priceRowId ??
      (row.line.priceSource === "imported"
        ? `pricebook:${normalizeDescription(row.line.description)}`
        : `line:${row.line.id}`);
    const key = JSON.stringify([
      identity,
      normalizeDescription(row.line.supplierName),
      normalizeUnit(row.line.unit),
      row.line.materialUnitCost,
      row.line.orderMultiple,
    ]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const required = group.reduce(
      (sum, row) => add(sum, row.required),
      decimal(0),
    );
    const multiple = group[0]!.line.orderMultiple ?? 0;
    const purchased = roundUpMultiple(required, multiple);
    const cost = group[0]!.line.materialUnitCost;
    const totalCents =
      cost === null
        ? 0
        : safeCents(
            roundInteger(
              multiply(multiply(purchased, decimal(cost)), decimal(100)),
            ),
          );
    // Largest-remainder allocation preserves group cents exactly, independently of row order.
    const allocations = group.map((row) => {
      const share = required.n ? divide(row.required, required) : decimal(0);
      row.purchase = multiply(purchased, share);
      const raw = multiply(decimal(totalCents), share);
      const floor = raw.n / raw.d;
      return {
        row,
        floor: Number(floor),
        remainder: { n: raw.n % raw.d, d: raw.d },
      };
    });
    let remaining =
      totalCents - allocations.reduce((sum, a) => sum + a.floor, 0);
    allocations.sort((a, b) => {
      const delta =
        a.remainder.n * b.remainder.d - b.remainder.n * a.remainder.d;
      return delta === 0n
        ? a.row.line.id.localeCompare(b.row.line.id)
        : delta > 0n
          ? -1
          : 1;
    });
    for (const allocation of allocations)
      allocation.row.materialCents =
        allocation.floor + (remaining-- > 0 ? 1 : 0);
  }
  return rows;
}

function totals(
  rows: WorkingLine[],
  settings: EstimatingSettings,
): EstimateTotals {
  const sum = (
    key:
      | "materialCents"
      | "laborCents"
      | "equipmentCents"
      | "subcontractCents"
      | "otherCents",
  ) => safeCents(rows.reduce((n, row) => n + BigInt(row[key]), 0n));
  const materialTotal = sum("materialCents"),
    laborTotal = sum("laborCents"),
    equipmentTotal = sum("equipmentCents"),
    subcontractTotal = sum("subcontractCents"),
    otherTotal = sum("otherCents");
  const directCost = safeCents(
    BigInt(materialTotal) +
      BigInt(laborTotal) +
      BigInt(equipmentTotal) +
      BigInt(subcontractTotal) +
      BigInt(otherTotal),
  );
  const overhead = applyPercent(directCost, settings.overheadPercent);
  const contingency = applyPercent(
    directCost + overhead,
    settings.contingencyPercent,
  );
  const beforeProfit = safeCents(
    BigInt(directCost) + BigInt(overhead) + BigInt(contingency),
  );
  const profit =
    settings.profitMode === "markup"
      ? applyPercent(beforeProfit, settings.profitPercent)
      : safeCents(
          roundInteger(
            divide(
              multiply(decimal(beforeProfit), decimal(settings.profitPercent)),
              decimal(100 - settings.profitPercent),
            ),
          ),
        );
  const subtotal = safeCents(BigInt(beforeProfit) + BigInt(profit));
  const tax = applyPercent(
    settings.taxBasis === "materials" ? materialTotal : subtotal,
    settings.taxPercent,
  );
  const cents = {
    materialTotal,
    laborTotal,
    equipmentTotal,
    subcontractTotal,
    otherTotal,
    directCost,
    overhead,
    contingency,
    profit,
    subtotal,
    tax,
    total: safeCents(BigInt(subtotal) + BigInt(tax)),
  };
  const dollars = Object.fromEntries(
    Object.entries(cents).map(([key, value]) => [key, money(value)]),
  ) as Omit<EstimateTotals, "cents" | "laborHours">;
  return {
    ...dollars,
    laborHours: numeric(
      rows.reduce((sum, row) => add(sum, row.laborHours), decimal(0)),
    ),
    cents,
  };
}

export function calculateEstimate(
  document: EstimateDocument,
  options: { now?: Date } = {},
) {
  const issues: EstimateWarning[] = [];
  const warningsByLine = new Map<string, string[]>();
  const warn = (
    code: string,
    message: string,
    lineId?: string,
    severity: "warning" | "error" = "warning",
  ) => {
    issues.push({ code, message, lineId, severity });
    if (lineId !== undefined) {
      const messages = warningsByLine.get(lineId) ?? [];
      messages.push(message);
      warningsByLine.set(lineId, messages);
    }
  };
  const now = options.now ?? new Date();
  const alternateMap = new Map(document.alternates.map((a) => [a.id, a]));
  const sourceKeys = new Set<string>();
  const lineIds = new Map<string, number>();
  for (const line of document.lines)
    lineIds.set(line.id, (lineIds.get(line.id) ?? 0) + 1);
  const billable: EstimateLine[] = [];
  const rejectedIds = new Set<string>();
  for (const line of document.lines) {
    if (line.reviewStatus === "excluded") continue;
    if ((lineIds.get(line.id) ?? 0) > 1) {
      warn(
        "duplicate-line",
        `${line.description}: duplicate line ID excluded from totals.`,
        line.id,
        "error",
      );
      rejectedIds.add(line.id);
      continue;
    }
    const key = estimateSourceKey(line);
    if (key && sourceKeys.has(key)) {
      warn(
        "duplicate-source",
        `${line.description}: this drawing evidence is already counted; duplicate excluded from totals.`,
        line.id,
        "error",
      );
      rejectedIds.add(line.id);
      continue;
    }
    const fields = [
      line.quantity,
      line.multiplier,
      line.wastePercent,
      line.laborHoursPerUnit,
      line.equipmentUnitCost,
      line.subcontractUnitCost,
      line.otherUnitCost,
      line.materialUnitCost ?? 0,
      line.laborRate ?? 0,
      line.orderMultiple ?? 0,
    ];
    if (fields.some((v) => !valid(v))) {
      warn(
        "invalid-value",
        `${line.description}: invalid quantity or rate excluded from totals.`,
        line.id,
        "error",
      );
      rejectedIds.add(line.id);
      continue;
    }
    if (!line.unit.trim()) {
      warn(
        "invalid-unit",
        `${line.description}: a quantity unit is required.`,
        line.id,
        "error",
      );
      rejectedIds.add(line.id);
      continue;
    }
    if (line.alternateId && !alternateMap.has(line.alternateId)) {
      warn(
        "unknown-alternate",
        `${line.description}: alternate is missing; line excluded from totals.`,
        line.id,
        "error",
      );
      rejectedIds.add(line.id);
      continue;
    }
    if (
      line.priceCurrency &&
      line.priceCurrency !== document.settings.currency
    ) {
      warn(
        "currency-mismatch",
        `${line.description}: ${line.priceCurrency} pricing differs from estimate currency ${document.settings.currency}; line excluded until pricing is corrected.`,
        line.id,
        "error",
      );
      rejectedIds.add(line.id);
      continue;
    }
    if (key) sourceKeys.add(key);
    if (line.quantity * line.multiplier > 0) {
      if (line.materialUnitCost === null || line.priceSource === "missing")
        warn(
          "missing-price",
          `${line.description}: material pricing is missing.`,
          line.id,
        );
      if (line.priceSource === "simulated")
        warn(
          "simulated-price",
          `${line.description}: simulated pricing requires supplier verification.`,
          line.id,
        );
      if (
        inferredKinds.has(line.source.kind) &&
        line.reviewStatus !== "approved"
      )
        warn(
          "unreviewed-source",
          `${line.description}: drawing quantity or inferred scope needs review.`,
          line.id,
        );
      if (
        line.source.confidence !== undefined &&
        line.source.confidence < 0.75 &&
        line.reviewStatus !== "approved"
      )
        warn(
          "low-confidence",
          `${line.description}: source confidence is below 75%.`,
          line.id,
        );
      if (line.priceUpdatedAt) {
        const updated = Date.parse(line.priceUpdatedAt);
        if (!Number.isFinite(updated))
          warn(
            "invalid-price-date",
            `${line.description}: pricing evidence has an invalid date.`,
            line.id,
          );
        else if (now.getTime() - updated > 90 * 86_400_000)
          warn(
            "stale-price",
            `${line.description}: pricing evidence is older than 90 days.`,
            line.id,
          );
        else if (updated > now.getTime() + 86_400_000)
          warn(
            "future-price-date",
            `${line.description}: pricing evidence has a future date.`,
            line.id,
          );
      } else if (
        line.priceSource === "supplier" ||
        line.priceSource === "imported"
      )
        warn(
          "undated-price",
          `${line.description}: supplier pricing has no evidence date.`,
          line.id,
        );
    }
    billable.push(line);
  }
  const settings = document.settings;
  if (
    [
      settings.laborRate,
      settings.laborBurdenPercent,
      settings.productivityFactor,
      settings.overheadPercent,
      settings.contingencyPercent,
      settings.profitPercent,
      settings.taxPercent,
    ].some((value) => !valid(value)) ||
    (settings.profitMode === "margin" && settings.profitPercent >= 100)
  )
    throw new Error("Invalid estimating settings.");
  // This cache lasts one calculation, so even in-place input changes are fresh.
  const prepared = new Map<EstimateLine, WorkingLine>();
  const baseLines = billable.filter((line) => !line.alternateId);
  const activeLines = billable.filter(
    (line) => !line.alternateId || alternateMap.get(line.alternateId)?.included,
  );
  const baseRows = calculateRows(baseLines, settings, prepared);
  const activeRows =
    activeLines.length === baseLines.length
      ? baseRows
      : calculateRows(activeLines, settings, prepared);
  const base = totals(baseRows, settings),
    selected =
      activeRows === baseRows
        ? { ...base, cents: { ...base.cents } }
        : totals(activeRows, settings);
  const purchaseSnapshots = new Map<string, WorkingLine[]>();
  for (const row of activeRows) {
    if (!row.demand.n) continue;
    const identity =
      row.line.supplierPartId ??
      row.line.partDefinitionId ??
      row.line.priceRowId;
    if (!identity) continue;
    const key = JSON.stringify([
      identity,
      normalizeDescription(row.line.supplierName),
      normalizeUnit(row.line.unit),
    ]);
    const group = purchaseSnapshots.get(key) ?? [];
    group.push(row);
    purchaseSnapshots.set(key, group);
  }
  for (const rows of purchaseSnapshots.values()) {
    if (
      new Set(
        rows.map((row) =>
          JSON.stringify([row.line.materialUnitCost, row.line.orderMultiple]),
        ),
      ).size > 1
    )
      for (const row of rows)
        warn(
          "price-conflict",
          `${row.line.description}: matching purchasable parts have different price or order-multiple snapshots; reconcile them before purchasing or approval.`,
          row.line.id,
        );
  }
  const activeMap = new Map(activeRows.map((row) => [row.line.id, row]));
  const optionalMap = new Map<string, WorkingLine>();
  const alternates = document.alternates.map((alternate) => {
    const own = calculateRows(
      billable.filter((line) => line.alternateId === alternate.id),
      settings,
      prepared,
    );
    for (const row of own) optionalMap.set(row.line.id, row);
    const withAlternate = totals(
      calculateRows(
        billable.filter(
          (line) => !line.alternateId || line.alternateId === alternate.id,
        ),
        settings,
        prepared,
      ),
      settings,
    );
    return {
      ...alternate,
      ...totals(own, settings),
      incrementalTotal: money(withAlternate.cents.total - base.cents.total),
    };
  });
  const lines: CalculatedEstimateLine[] = document.lines.map((line) => {
    const row = activeMap.get(line.id) ?? optionalMap.get(line.id);
    const safeRow =
      line.reviewStatus !== "excluded" && !rejectedIds.has(line.id)
        ? row
        : undefined;
    const materialTotal = money(safeRow?.materialCents ?? 0),
      laborTotal = money(safeRow?.laborCents ?? 0),
      equipmentTotal = money(safeRow?.equipmentCents ?? 0),
      subcontractTotal = money(safeRow?.subcontractCents ?? 0),
      otherTotal = money(safeRow?.otherCents ?? 0);
    return {
      ...line,
      demand: safeRow ? numeric(safeRow.demand) : 0,
      requiredQuantity: safeRow ? numeric(safeRow.required) : 0,
      purchaseQuantity: safeRow ? numeric(safeRow.purchase) : 0,
      materialTotal,
      laborHours: safeRow ? numeric(safeRow.laborHours) : 0,
      laborTotal,
      equipmentTotal,
      subcontractTotal,
      otherTotal,
      directCost: money(
        (safeRow?.materialCents ?? 0) +
          (safeRow?.laborCents ?? 0) +
          (safeRow?.equipmentCents ?? 0) +
          (safeRow?.subcontractCents ?? 0) +
          (safeRow?.otherCents ?? 0),
      ),
      included: Boolean(safeRow && activeMap.has(line.id)),
      warnings: [...(warningsByLine.get(line.id) ?? [])],
    };
  });
  const grouped = (field: "trade" | "costCode" | "area") => {
    const map = new Map<string, WorkingLine[]>();
    for (const row of activeRows) {
      const label = row.line[field] || "Unassigned";
      const group = map.get(label) ?? [];
      group.push(row);
      map.set(label, group);
    }
    return [...map]
      .map(([name, rows]) => ({
        name,
        lineCount: rows.length,
        ...totals(rows, settings),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  const activeIds = new Set(activeRows.map((row) => row.line.id));
  const activeIssues = issues.filter(
    (issue) =>
      !issue.lineId ||
      activeIds.has(issue.lineId) ||
      issue.severity === "error",
  );
  const missingPrices = activeIssues.filter(
    (i) => i.code === "missing-price",
  ).length;
  const simulatedPrices = activeIssues.filter(
    (i) => i.code === "simulated-price",
  ).length;
  const unreviewed = activeIssues.filter(
    (i) => i.code === "unreviewed-source",
  ).length;
  const confidenceRows = activeRows.filter(
    (row) => row.line.source.confidence !== undefined,
  );
  const confidence = confidenceRows.length
    ? confidenceRows.reduce(
        (sum, row) => sum + row.line.source.confidence!,
        0,
      ) / confidenceRows.length
    : null;
  const affected = new Set(
    activeIssues.filter((i) => i.lineId).map((i) => i.lineId),
  );
  const hasDemand = activeRows.some((row) => row.demand.n > 0n);
  const readiness = {
    ready: hasDemand && activeIssues.length === 0,
    score: hasDemand
      ? Math.max(
          0,
          Math.round(
            100 *
              (1 - affected.size / Math.max(activeRows.length, affected.size)),
          ),
        )
      : 0,
    unreviewed,
    missingPrices,
    simulatedPrices,
  };
  return {
    lines,
    base,
    selected,
    total: selected,
    alternates,
    groups: {
      trade: grouped("trade"),
      costCode: grouped("costCode"),
      area: grouped("area"),
    },
    issues,
    warnings: issues.map((i) => i.message),
    readiness,
    confidence,
  };
}
