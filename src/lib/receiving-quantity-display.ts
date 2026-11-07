/** Each is implicit in receiving quantities; keep stored units for conversions. */
export function receivingDisplayUnit(unit: string) {
  return /^(?:ea|each)\.?$/i.test(unit.trim()) ? "" : unit.trim();
}
export function receivingQuantity(value: number | string, unit: string) {
  return [String(value), receivingDisplayUnit(unit)].filter(Boolean).join(" ");
}
