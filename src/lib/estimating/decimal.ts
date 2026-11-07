/** Decimal arithmetic for quantities and cents, without binary floating point rounding. */
export type Decimal = { n: bigint; d: bigint };
function fraction(n: bigint, d: bigint): Decimal {
  if (!d) throw new Error("Cannot divide by zero.");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let a = n < 0n ? -n : n,
    b = d;
  while (b) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return { n: n / a, d: d / a };
}
export function decimal(value: number): Decimal {
  if (!Number.isFinite(value))
    throw new Error("An estimate value is not finite.");
  const [coefficient = "0", exponent = "0"] = value
    .toString()
    .toLowerCase()
    .split("e");
  const places = coefficient.split(".")[1]?.length ?? 0;
  const n = BigInt(coefficient.replace(".", ""));
  const power = places - Number(exponent);
  return power >= 0
    ? fraction(n, 10n ** BigInt(power))
    : fraction(n * 10n ** BigInt(-power), 1n);
}
export const add = (a: Decimal, b: Decimal): Decimal =>
  fraction(a.n * b.d + b.n * a.d, a.d * b.d);
export const multiply = (a: Decimal, b: Decimal): Decimal =>
  fraction(a.n * b.n, a.d * b.d);
export const divide = (a: Decimal, b: Decimal): Decimal => {
  if (b.n === 0n) throw new Error("Cannot divide by zero.");
  return fraction(a.n * b.d, a.d * b.n);
};
export const numeric = (a: Decimal) => Number(a.n) / Number(a.d);
export function roundInteger(a: Decimal): bigint {
  const negative = a.n < 0n;
  const numerator = negative ? -a.n : a.n;
  const rounded = (numerator * 2n + a.d) / (a.d * 2n);
  return negative ? -rounded : rounded;
}
export function safeCents(value: bigint) {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new Error("Estimate exceeds the supported monetary range.");
  return Number(value);
}
export const applyPercent = (cents: number, percent: number) =>
  safeCents(
    roundInteger(
      divide(multiply(decimal(cents), decimal(percent)), decimal(100)),
    ),
  );
export function roundUpMultiple(value: Decimal, multiple: number): Decimal {
  if (!(multiple > 0)) return value;
  const count = divide(value, decimal(multiple));
  return multiply(
    { n: (count.n + count.d - 1n) / count.d, d: 1n },
    decimal(multiple),
  );
}
