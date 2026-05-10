import type {
  OfflineMaterialListItem,
  OfflineMaterialListRecord,
} from "~/lib/offline-material-list";
import type { OfflineMaterialListMutation } from "~/lib/offline-material-list-mutations";

function toMoneyString(value: number) {
  return Number.isFinite(value) ? value.toString() : "0";
}

function recalculateMaterialTotal(items: OfflineMaterialListItem[]) {
  return items.reduce((sum, item) => {
    const price = item.extendedPrice ? parseFloat(item.extendedPrice.toString()) : 0;
    return sum + (Number.isFinite(price) ? price : 0);
  }, 0);
}

function dedupeItemsById(items: OfflineMaterialListItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const itemId = String(item.id);
    if (seen.has(itemId)) return false;
    seen.add(itemId);
    return true;
  });
}

function makeAddedItem(mutation: Extract<OfflineMaterialListMutation, { type: "addItem" }>) {
  const quantity = mutation.quantity;
  const rawUnitCost = mutation.unitCost ?? mutation.supplierPartSnapshot?.lastKnownUnitCost ?? 0;
  const unitCost = parseFloat(String(rawUnitCost));
  const extendedPrice = quantity * (Number.isFinite(unitCost) ? unitCost : 0);

  const item: OfflineMaterialListItem = {
    id: mutation.localItemId,
    quantity: quantity.toString(),
    unitCost: toMoneyString(Number.isFinite(unitCost) ? unitCost : 0),
    extendedPrice: toMoneyString(extendedPrice),
    descriptionSnapshot:
      mutation.partDefinitionSnapshot?.displayName ?? mutation.oneOffDisplayName ?? null,
    createdAt: mutation.queuedAt,
    updatedAt: mutation.queuedAt,
    syncVersion: mutation.clientMutationId ?? mutation.queuedAt,
    partDefinition: mutation.partDefinitionSnapshot
      ? {
          id: mutation.partDefinitionSnapshot.id,
          displayName: mutation.partDefinitionSnapshot.displayName,
          imageUrl: mutation.partDefinitionSnapshot.imageUrl,
          material: mutation.partDefinitionSnapshot.material,
        }
      : null,
    supplierPart: mutation.supplierPartSnapshot
      ? {
          id: mutation.supplierPartSnapshot.id,
          supplierId: mutation.supplierPartSnapshot.supplierId,
          supplierSku: mutation.supplierPartSnapshot.supplierSku,
          lastKnownUnitCost: mutation.supplierPartSnapshot.lastKnownUnitCost,
          supplier: mutation.supplierPartSnapshot.supplier,
        }
      : null,
    uom: null,
    oneOff: mutation.oneOffDisplayName
      ? {
          displayName: mutation.oneOffDisplayName,
          description: mutation.oneOffDescription ?? null,
          material: mutation.oneOffMaterial ?? null,
          sizeNominal:
            mutation.oneOffSizeNominal !== undefined
              ? mutation.oneOffSizeNominal.toString()
              : null,
          sizeUnitId: mutation.oneOffSizeUnitId ?? null,
        }
      : null,
  };

  return item;
}

export function projectMaterialListWithMutations(
  base: OfflineMaterialListRecord,
  mutations: OfflineMaterialListMutation[],
): OfflineMaterialListRecord {
  const relevantMutations = mutations.filter(
    (mutation) => mutation.materialListId === base.materialList.id,
  );
  if (relevantMutations.length === 0) return base;

  let items = [...base.items];
  let name = base.materialList.name;

  for (const mutation of relevantMutations) {
    switch (mutation.type) {
      case "addItem": {
        if (!items.some((item) => String(item.id) === mutation.localItemId)) {
          items = [...items, makeAddedItem(mutation)];
        }
        break;
      }
      case "updateItemQuantity": {
        items = items.map((item) => {
          if (String(item.id) !== mutation.itemId) return item;
          const unitCost = item.unitCost ? parseFloat(item.unitCost.toString()) : 0;
          const safeUnitCost = Number.isFinite(unitCost) ? unitCost : 0;
          return {
            ...item,
            quantity: mutation.quantity.toString(),
            extendedPrice: toMoneyString(mutation.quantity * safeUnitCost),
          };
        });
        break;
      }
      case "updateItemSupplierPart": {
        items = items.map((item) => {
          if (String(item.id) !== mutation.itemId) return item;
          const quantity = item.quantity ? parseFloat(item.quantity.toString()) : 0;
          const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
          const unitCost = mutation.unitCost ?? 0;
          return {
            ...item,
            unitCost: toMoneyString(unitCost),
            extendedPrice: toMoneyString(safeQuantity * unitCost),
            supplierPart: mutation.supplierPartSnapshot,
            selectedSupplierId: mutation.supplierId ?? mutation.supplierPartSnapshot?.supplierId ?? null,
          } as OfflineMaterialListItem;
        });
        break;
      }
      case "removeItem": {
        items = items.filter((item) => String(item.id) !== mutation.itemId);
        break;
      }
      case "renameMaterialList": {
        name = mutation.name;
        break;
      }
    }
  }

  const dedupedItems = dedupeItemsById(items);

  return {
    ...base,
    materialList: {
      ...base.materialList,
      name,
    },
    items: dedupedItems,
    materialTotal: recalculateMaterialTotal(dedupedItems),
  };
}
