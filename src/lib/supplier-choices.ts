import type { OfflineSupplierPartOption } from "./offline-supplier-parts";
import { makeOfflineSupplierPartId } from "./offline-suppliers";
import type { SupplierVersion } from "./job-supplier-defaults";
import type { SupplierPricingLabelEntry } from "./supplier-label";

type Supplier = { id: string; name: string; kind?: string | null };
export type SupplierChoice = {
  key: string;
  label: string;
  version: SupplierVersion | null;
  listing: OfflineSupplierPartOption;
};

// Older offline snapshots predate the supplier kind field.
export function isPurchasingSupplier(supplier: Supplier) {
  return supplier.kind
    ? supplier.kind !== "tool_room"
    : !/^tool\s*room$/i.test(supplier.name.trim());
}

export function buildSupplierChoices(
  partId: string,
  suppliers: readonly Supplier[],
  listings: readonly OfflineSupplierPartOption[],
  entries: readonly SupplierPricingLabelEntry[],
) {
  const available = new Map(
    suppliers.map((supplier) => [supplier.id, supplier]),
  );
  for (const listing of listings) {
    if (!available.has(listing.supplierId))
      available.set(listing.supplierId, listing.supplier);
  }
  const standard: SupplierChoice[] = [...available.values()]
    .filter(isPurchasingSupplier)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((supplier) => {
      const matches = listings.filter(
        (listing) => listing.supplierId === supplier.id,
      );
      const listing = matches.find((item) => item.isPreferred) ?? matches[0];
      return {
        key: `${supplier.id}:standard`,
        label: supplier.name,
        version: {
          supplierId: supplier.id,
          bookId: null,
          label: supplier.name,
        },
        listing: {
          id: makeOfflineSupplierPartId(partId, supplier.id),
          supplierId: supplier.id,
          supplierSku: null,
          lastKnownUnitCost: null,
          isPreferred: false,
          ...listing,
          supplier: { id: supplier.id, name: supplier.name },
          priceBookName: "Standard",
        },
      };
    });
  const jobSpecific = new Map<string, SupplierChoice>();
  for (const entry of entries) {
    if (entry.partDefinitionId !== partId) continue;
    const supplier =
      available.get(entry.supplierId) ??
      (entry.supplierName
        ? { id: entry.supplierId, name: entry.supplierName }
        : null);
    if (!supplier || !isPurchasingSupplier(supplier)) continue;
    const listing = listings.find((item) => item.id === entry.supplierPartId);
    const label = `${supplier.name} - ${entry.priceBookName}`;
    const key = `${supplier.id}:${entry.supplierPriceBookId ?? entry.priceBookName}`;
    if (jobSpecific.has(key)) continue;
    jobSpecific.set(key, {
      key,
      label,
      // Legacy job lists without a linked supplier book retain job-price resolution.
      version: entry.supplierPriceBookId
        ? { supplierId: supplier.id, bookId: entry.supplierPriceBookId, label }
        : null,
      listing: {
        id: entry.supplierPartId,
        supplierId: supplier.id,
        supplierSku: entry.supplierSku ?? listing?.supplierSku ?? null,
        lastKnownUnitCost: entry.unitCost ?? null,
        packSize: listing?.packSize ?? null,
        isPreferred: false,
        supplier: { id: supplier.id, name: supplier.name },
        priceBookName: entry.priceBookName,
      },
    });
  }
  return {
    standard,
    jobSpecific: [...jobSpecific.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
  };
}
