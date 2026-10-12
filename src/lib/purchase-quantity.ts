import { packContents } from "./pack-quantity";
/** Demand stays in selling units. Packaged parts buy whole packs; order multiples remain independent. */
export function purchaseQuantity(
  required: string | number | null | undefined,
  multiple?: string | number | null,
  piecesPerPack?: number | null,
): number {
  const quantity =
    packContents(piecesPerPack) > 1
      ? Math.ceil(Number(required))
      : Number(required);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  const step = Number(multiple);
  if (!Number.isFinite(step) || step <= 0) return quantity;
  // DB quantities have six decimal places. Integer arithmetic avoids rounding
  // an exact multiple up because of floating point noise (e.g. 0.3 / 0.1).
  const amount = Math.round(quantity * 1_000_000);
  let increment = Math.round(step * 1_000_000);
  if (packContents(piecesPerPack) > 1 && increment > 0) {
    // Respect both a supplier's fractional multiple and the whole-pack rule.
    let a = increment,
      b = 1_000_000;
    while (b) {
      const remainder = a % b;
      a = b;
      b = remainder;
    }
    increment = (increment / a) * 1_000_000;
  }
  if (increment < 1) return quantity;
  return (Math.ceil(amount / increment) * increment) / 1_000_000;
}

export function purchaseLineTotal(
  required: string | number | null | undefined,
  unitCost: string | number | null | undefined,
  multiple?: string | number | null,
  piecesPerPack?: number | null,
): number {
  const cost = Number(unitCost);
  if (!Number.isFinite(cost)) return 0;
  // Match numeric(12,6) quantities, numeric(12,4) unit costs and cent prices.
  // Exact arithmetic also prevents repeatedly rewriting prices for float noise.
  const amount = BigInt(
    Math.round(purchaseQuantity(required, multiple, piecesPerPack) * 1_000_000),
  );
  const rate = BigInt(Math.round(cost * 10_000));
  const product = amount * rate;
  const cents =
    product < 0n
      ? -((-product + 50_000_000n) / 100_000_000n)
      : (product + 50_000_000n) / 100_000_000n;
  return Number(cents) / 100;
}

export function formatPurchaseQuantity(
  required: string | number,
  ordered: string | number,
) {
  const format = (value: string | number) =>
    Number(value).toLocaleString("en-CA", { maximumFractionDigits: 6 });
  return Number(required) === Number(ordered)
    ? format(required)
    : `${format(required)} (${format(ordered)})`;
}

export function isValidOrderMultiple(value: string): boolean {
  return (
    /^\d+(?:\.\d{1,6})?$/.test(value.trim()) &&
    Number(value) > 0 &&
    Number(value) <= 999_999
  );
}
