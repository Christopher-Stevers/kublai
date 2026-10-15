/** A listing is an approval to purchase a particular part from a particular supplier. */
export type JobPriceEntry = {
  id: string;
  partDefinitionId: string;
  supplierId: string;
  supplierPartId: string;
  supplierSku: string | null;
  unitCost: string | null;
  priceStatus: string;
};

export function findJobPrice<T extends JobPriceEntry>(
  entries: T[],
  partId?: string | null,
  supplierId?: string | null,
  supplierPartId?: string | null,
): T | undefined {
  if (!partId) return undefined;
  const candidates = entries.filter(
    (e) =>
      e.partDefinitionId === partId &&
      (!supplierId || e.supplierId === supplierId),
  );
  return (
    candidates.find((e) => e.supplierPartId === supplierPartId) ?? candidates[0]
  );
}

/** Stable partition: retain the user's ordinary sort within each group. */
export function listedPartsFirst<T>(
  items: readonly T[],
  listed: (item: T) => boolean,
): T[] {
  return [...items.filter(listed), ...items.filter((item) => !listed(item))];
}

export type ApprovalSnapshotItem = {
  id: string;
  partDefinitionId: string | null;
  supplierPartId: string | null;
  supplierSku: string | null;
  quantity: string;
  requestedQuantity?: string;
  unitCost: string | null;
  descriptionSnapshot: string | null;
  listed: boolean;
};

/** Canadian-dollar spreadsheet input. Reject decimal-comma ambiguity and silent rounding. */
export function parseJobPrice(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  if (!/^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,4})?$/.test(raw))
    throw new Error(
      "Use a non-negative CAD amount with up to four decimals, for example 1,234.56.",
    );
  const amount = Number(raw.replace(/[$,]/g, ""));
  if (!Number.isFinite(amount) || amount > 99999999)
    throw new Error("CAD amount exceeds the supported range.");
  return amount;
}
