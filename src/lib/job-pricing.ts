/** A listing is an approval to purchase a particular part from a particular supplier. */
export type JobPriceEntry = {
  id: string;
  partDefinitionId: string;
  supplierId: string;
  supplierPartId: string;
  preferJobPricing?: boolean;
  supplierSku: string | null;
  unitCost: string | null;
  priceStatus: string;
};

export type JobPriceIndex<T extends JobPriceEntry = JobPriceEntry> =
  ReadonlyMap<string, readonly T[]>;

/** Build once per price-book snapshot, then inspect only a part's own listings. */
export function indexJobPrices<T extends JobPriceEntry>(
  entries: readonly T[],
): JobPriceIndex<T> {
  const index = new Map<string, T[]>();
  for (const entry of entries) {
    const group = index.get(entry.partDefinitionId);
    if (group) group.push(entry);
    else index.set(entry.partDefinitionId, [entry]);
  }
  return index;
}

export function findJobPrice<T extends JobPriceEntry>(
  entries: readonly T[] | JobPriceIndex<T>,
  partId?: string | null,
  supplierId?: string | null,
  supplierPartId?: string | null,
): T | undefined {
  if (!partId) return undefined;
  const candidates = (
    "get" in entries ? (entries.get(partId) ?? []) : entries
  ).filter(
    (e) =>
      e.partDefinitionId === partId &&
      (!supplierId || e.supplierId === supplierId),
  );
  return (
    candidates.find((e) => e.supplierPartId === supplierPartId) ?? candidates[0]
  );
}

/** Respect the supplier preference when applying prices; membership remains independent. */
export function findPreferredJobPrice<T extends JobPriceEntry>(
  entries: readonly T[] | JobPriceIndex<T>, partId?:string|null,
  supplierId?:string|null, supplierPartId?:string|null,
): T | undefined {
  const eligible = ("get" in entries ? entries.get(partId ?? "") ?? [] : entries).filter(e=>e.preferJobPricing!==false);
  return findJobPrice(eligible,partId,supplierId,supplierPartId);
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
