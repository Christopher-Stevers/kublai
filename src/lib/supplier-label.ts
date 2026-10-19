/** Display labels only: never write these back as supplier identities. */
export function supplierLabel(
  name: string | null | undefined,
  book = "Standard",
  fallback = "No supplier",
) {
  return name?.trim() ? `${name} - ${book}` : fallback;
}
export function orderPriceBookLabel(
  items: readonly { priceBookNameSnapshot?: string | null }[],
) {
  const names = [
    ...new Set(
      items.map((item) => item.priceBookNameSnapshot || "Not recorded"),
    ),
  ];
  return names.length ? names.sort().join(" / ") : "Not recorded";
}
export type SupplierPricingLabelEntry = {
  supplierId: string;
  supplierPartId: string;
  partDefinitionId: string;
  priceBookName: string;
  preferJobPricing?: boolean;
};
export function applicablePriceBook(
  entries: readonly SupplierPricingLabelEntry[],
  supplierId?: string | null,
  partId?: string | null,
  listingId?: string | null,
) {
  const matches = entries.filter(
    (e) =>
      e.supplierId === supplierId &&
      e.preferJobPricing !== false &&
      (!partId || e.partDefinitionId === partId),
  );
  const entry =
    matches.find((e) => e.supplierPartId === listingId) ?? matches[0];
  return entry?.priceBookName ?? "Standard";
}
