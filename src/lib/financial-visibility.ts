/** Known structured monetary fields; counts, quantities and dimensions stay intact. */
const MONEY_FIELDS = new Set([
  "lastKnownUnitCost", "supplierPartLastKnownUnitCost", "unitCost",
  "unitCostAtOrderTime", "extendedPrice", "materialTotal", "subtotalMaterials",
  "laborRate", "subtotalLabor", "defaultMarkupPercent", "subtotal", "lineTotal", "scheduledValue", "completedValue", "completedToDate",
  "contractSumCents", "billedToDateCents", "scheduledCents", "previousCents",
  "thisPeriodCents", "completedToDateCents", "balanceToFinishCents",
  "retainageCents", "earnedLessRetainageCents", "previousCertificatesCents",
  "currentPaymentDueCents", "markupPercent",
]);

/**
 * Mask prices before they leave the server, preserving scalar types for existing
 * clients. Never change database values or a shared snapshot in place.
 */
export function redactFinancialValues<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactFinancialValues) as T;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    // Quote totals are decimal strings. Numeric totals elsewhere are counts.
    const money = MONEY_FIELDS.has(key) || (key === "total" && typeof item === "string");
    result[key] = money ? emptyValue(item) : redactFinancialValues(item);
  }
  return result as T;
}

function emptyValue(value: unknown): unknown {
  if (typeof value === "number") return 0;
  if (typeof value === "string") return "";
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).map(key => [key, emptyValue((value as Record<string, unknown>)[key])]));
  }
  return null;
}
