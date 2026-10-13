/** Quantities and prices remain in selling packs. Pack contents are independent of order multiples. */
export function packContents(value?: number | null): number {
  return Number.isSafeInteger(value) && Number(value) > 1 ? Number(value) : 1;
}
export function pieceCount(packs: number, contents?: number | null): number {
  return Math.round(packs * packContents(contents));
}
export function packsFromPieces(
  pieces: number,
  contents?: number | null,
): number {
  return Math.round((pieces / packContents(contents)) * 1_000_000) / 1_000_000;
}
export function formatPackQuantity(
  packs: number,
  contents?: number | null,
  orderedPacks = Math.ceil(packs),
): string {
  const value = (
    packContents(contents) > 1 ? orderedPacks : packs
  ).toLocaleString("en-CA", { maximumFractionDigits: 6 });
  return packContents(contents) > 1
    ? `${value} (x${pieceCount(packs, contents)})`
    : value;
}
/** The list below zero is the piece list: -1 = one piece, -2 = two pieces. */
export function pickerQuantity(
  index: number,
  contents?: number | null,
): number {
  return index < 0 && packContents(contents) > 1
    ? packsFromPieces(-index, contents)
    : Math.max(0, index);
}
export function pickerIndex(packs: number, contents?: number | null): number {
  return packContents(contents) > 1 && !Number.isInteger(packs)
    ? -pieceCount(packs, contents)
    : packs;
}

export function individualUnitLabel(unit?: string | null) {
  const value = unit?.trim().toLowerCase();
  return ({ pcs: "piece", pieces: "piece", feet: "foot", inches: "inch" } as Record<string, string>)[value ?? ""] ?? (value || "piece");
}

export function appendQuantityDescription(description: string, count?: number | null, individualUnit?: string | null, bulkUnit?: string | null): string {
  if (!count || !individualUnit?.trim() || !bulkUnit?.trim()) return description.trim();
  const base = description.trim().replace(/\s*\(\d[\d,]*\s+[^()]+\s+per\s+[^()]+\)\s*$/i, "");
  return `${base} (${count} ${individualUnit.trim()} per ${bulkUnit.trim()})`.trim();
}

/** Email quantities describe the contents purchased, rather than the smaller demand. */
export function formatOrderedBulkQuantity(ordered: number, contents?: number | null, bulkUnit?: string | null, individualUnit?: string | null): string {
  const unit = bulkUnit || "pack";
  const plural = ({box:"boxes", pack:"packs", coil:"coils", roll:"rolls", length:"lengths"} as Record<string,string>)[unit] || unit;
  return `${ordered.toLocaleString("en-CA", {maximumFractionDigits:6})} ${ordered === 1 ? unit : plural} (${pieceCount(ordered, contents)} ${individualUnit || "pcs"})`;
}
