/**
 * Shared utilities for parsing and formatting size values
 * Handles fractions, decimals, mixed numbers, and unicode fractions
 */

const IMPERIAL_UNITS = new Set(["in", "ft", "yd"]);
const INCH_UNITS = new Set(["in", "inch", "inches", '"']);

function formatUnitForDimension(unit: string | null | undefined): string {
  const normalized = String(unit ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (INCH_UNITS.has(normalized)) return '"';
  return ` ${unit}`;
}

function stripUnitFromDimension(value: string, unit: string | null | undefined): string {
  const normalizedUnit = String(unit ?? "").trim();
  let result = value.trim().replace(/[”″"]/g, "");

  if (normalizedUnit) {
    result = result.replace(new RegExp(`\\s*${normalizedUnit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
  }

  return result.replace(/\s*(inches|inch|in)\s*$/i, "").trim();
}

/**
 * Parse size string to normalized number
 * Handles fractions (1/2 → 0.5), decimals (0.5 → 0.5), mixed (1 1/2 → 1.5), and unicode fractions (1 ½ → 1.5)
 */
export function parseSizeInput(input: string): number | null {
  if (!input || typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // Try parsing as decimal first
  const decimal = parseFloat(trimmed);
  if (!isNaN(decimal) && isFinite(decimal)) {
    // Check if it's a pure decimal (not a fraction that happens to parse)
    if (!trimmed.includes("/")) {
      return decimal;
    }
  }

  // Handle fractions: "1/2", "3/4", etc.
  const fractionMatch = /^(\d+)\/(\d+)$/.exec(trimmed);
  if (fractionMatch) {
    const numerator = parseFloat(fractionMatch[1] ?? "0");
    const denominator = parseFloat(fractionMatch[2] ?? "1");
    if (denominator !== 0) {
      return numerator / denominator;
    }
  }

  // Handle mixed numbers: "1 1/2", "2 3/4", etc.
  const mixedMatch = /^(\d+)\s+(\d+)\/(\d+)$/.exec(trimmed) ?? /^(\d+)-(\d+)\/(\d+)$/.exec(trimmed);
  if (mixedMatch) {
    const whole = parseFloat(mixedMatch[1] ?? "0");
    const numerator = parseFloat(mixedMatch[2] ?? "0");
    const denominator = parseFloat(mixedMatch[3] ?? "1");
    if (denominator !== 0) {
      return whole + numerator / denominator;
    }
  }

  // Handle unicode fractions: "1 ½", "2 ¾", etc.
  const unicodeFractions: Record<string, number> = {
    "½": 0.5,
    "⅓": 1 / 3,
    "⅔": 2 / 3,
    "¼": 0.25,
    "¾": 0.75,
    "⅕": 0.2,
    "⅖": 0.4,
    "⅗": 0.6,
    "⅘": 0.8,
    "⅙": 1 / 6,
    "⅚": 5 / 6,
    "⅛": 0.125,
    "⅜": 0.375,
    "⅝": 0.625,
    "⅞": 0.875,
  };

  for (const [unicode, value] of Object.entries(unicodeFractions)) {
    if (trimmed.includes(unicode)) {
      const wholeMatch = trimmed.match(/^(\d+)\s*/);
      const whole = wholeMatch ? parseFloat(wholeMatch[1] ?? "0") : 0;
      return whole + value;
    }
  }

  // If all else fails, try parsing as number
  const final = parseFloat(trimmed);
  if (!isNaN(final) && isFinite(final)) {
    return final;
  }

  return null;
}

/**
 * Format size for display
 * Converts numeric values to readable format with fractions
 */
export function formatSize(nominal: number | string | null, unit: string | null): string {
  if (nominal === null || unit === null) return "";

  const num = typeof nominal === "string" ? parseFloat(nominal) : nominal;
  if (!Number.isFinite(num)) return "";

  if (IMPERIAL_UNITS.has(unit)) {
    return `${decimalToFraction(num)} ${unit}`;
  }

  return `${formatSizeDecimal(num)} ${unit}`;
}

/**
 * Format one or more size dimensions for generated part names.
 * Examples: 4 x 4 x 4 + in -> 4" x 4" x 4", 0.5 + in -> 1/2".
 */
export function formatSizeDimensions(
  nominal: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  if (nominal === null || nominal === undefined || nominal === "") return "";

  const unitSuffix = formatUnitForDimension(unit);
  const parts = String(nominal)
    .trim()
    .split(/\s*(?:x|×)\s*/i)
    .map((part) => stripUnitFromDimension(part, unit))
    .filter(Boolean);

  return parts
    .map((part) => {
      const numeric = parseSizeInput(part);
      const formatted = numeric === null ? part : decimalToFraction(numeric);
      return `${formatted}${unitSuffix}`;
    })
    .join(" x ");
}

export function generatePartDisplayName(input: {
  sizeNominal?: number | string | null;
  sizeUnit?: string | null;
  material?: string | null;
  description?: string | null;
}): string {
  return [
    formatSizeDimensions(input.sizeNominal, input.sizeUnit),
    input.material?.trim(),
    input.description?.trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/**
 * Format a decimal size using the fewest decimal places needed.
 * Keeps user-facing edit inputs tidy when DB decimals arrive as strings like "3.0000".
 */
export function formatSizeDecimal(nominal: number | string | null): string {
  if (nominal === null) return "";

  const raw = typeof nominal === "string" ? nominal.trim() : nominal.toString();
  if (!raw) return "";

  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;

  return num.toString();
}

/**
 * Convert a decimal number to fractional format (down to 1/16)
 * @param num - The decimal number to convert
 * @returns A string representation in fractional format (e.g., "2 1/4", "1/8")
 */
export function decimalToFraction(num: number): string {
  if (Number.isInteger(num)) {
    return num.toString();
  }

  // Handle negative numbers
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const whole = Math.floor(absNum);
  const fractional = absNum - whole;

  // Convert fractional part to sixteenths
  // Round to nearest 1/16 to handle floating point precision issues
  const sixteenths = Math.round(fractional * 16);

  // If it's exactly 0 after rounding, return just the whole number
  if (sixteenths === 0) {
    return isNegative ? `-${whole}` : whole.toString();
  }

  // Simplify the fraction by finding GCD
  const gcd = (a: number, b: number): number => {
    return b === 0 ? a : gcd(b, a % b);
  };
  const divisor = gcd(sixteenths, 16);
  const numerator = sixteenths / divisor;
  const denominator = 16 / divisor;

  // Build the result
  let result = "";
  if (isNegative) {
    result += "-";
  }
  if (whole > 0) {
    result += `${whole} `;
  }
  result += `${numerator}/${denominator}`;

  return result;
}

/**
 * Format a size string to display in fractional format
 * Parses strings like "2.25 in" or "0.125" and converts to "2 1/4 in" or "1/8"
 * @param sizeString - The size string to format (e.g., "2.25 in", "0.125")
 * @returns The formatted size string with fractions, or the original string if it can't be parsed
 */
export function formatSizeAsFraction(sizeString: string | null): string {
  if (!sizeString) return "";

  const trimmed = sizeString.trim();
  if (trimmed.includes("/")) {
    return trimmed;
  }

  const match = trimmed.match(/^(-?\d+\.?\d*)\s*(\S+)?$/);
  if (!match) {
    return trimmed;
  }

  const numericPart = match[1];
  const unit = match[2] ?? null;

  if (!numericPart) {
    return trimmed;
  }

  const numericValue = parseFloat(numericPart);
  if (isNaN(numericValue) || !isFinite(numericValue)) {
    return trimmed;
  }

  return formatSize(numericValue, unit);
}

