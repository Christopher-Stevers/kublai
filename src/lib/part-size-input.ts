import { parseSizeInput } from "./size-utils";

/** Allow unfinished numeric dimensions while typing, but never units or words. */
export function isPartSizeInput(value: string): boolean {
  if (!/^[0-9xX./\s-]*$/.test(value)) return false;
  const normalized = value.toLowerCase();
  if (/^\s*x/.test(normalized) || /x\s*x/.test(normalized)) return false;
  return normalized.split("x").every((segment) => {
    const text = segment.trim();
    return (
      !text || /^(?:\d*(?:\.\d*)?|\d+\/\d*|\d+(?:\s+|-)\d*\/?\d*)$/.test(text)
    );
  });
}

/** Canonical storage: numeric dimensions only; units live on the size record. */
export function normalizePartSize(value: string): string | null {
  if (!value.trim()) return "";
  if (!/^[0-9xX./\s-]+$/.test(value)) return null;
  const dimensions = value
    .toLowerCase()
    .split("x")
    .map((segment) => {
      const text = segment.trim();
      if (!/^(?:\d+(?:\.\d+)?|\.\d+|\d+\/\d+|\d+(?:\s+|-)\d+\/\d+)$/.test(text))
        return null;
      const number = parseSizeInput(text);
      return number !== null && number >= 0 ? String(number) : null;
    });
  return dimensions.some((value) => value === null)
    ? null
    : dimensions.join(" x ");
}
