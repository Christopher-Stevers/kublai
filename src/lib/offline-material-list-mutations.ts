import {
  patchOfflineMaterialList,
  type OfflineMaterialListRecord,
} from "~/lib/offline-material-list";

export type OfflineMaterialListMutation =
  | {
      type: "updateItemQuantity";
      materialListId: string;
      itemId: string;
      quantity: number;
      queuedAt: string;
    }
  | {
      type: "removeItem";
      materialListId: string;
      itemId: string;
      queuedAt: string;
    }
  | {
      type: "renameMaterialList";
      materialListId: string;
      name: string;
      queuedAt: string;
    };

const QUEUE_STORAGE_KEY = "foremanhq.offline.material-list.queue";

export function getOfflineMutationQueue(): OfflineMaterialListMutation[] {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as OfflineMaterialListMutation[];
  } catch {
    return [];
  }
}

export function enqueueOfflineMutation(mutation: OfflineMaterialListMutation) {
  if (typeof window === "undefined") return;

  const queue = getOfflineMutationQueue();
  queue.push(mutation);
  window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

function recalculateMaterialTotal(record: OfflineMaterialListRecord) {
  return record.items.reduce((sum, item) => {
    const price = item.extendedPrice ? parseFloat(item.extendedPrice) : 0;
    return sum + price;
  }, 0);
}

export function applyOfflineQuantityUpdate(
  materialListId: string,
  itemId: string,
  quantity: number,
) {
  return patchOfflineMaterialList(
    materialListId,
    (current) => {
      const items = current.items.map((item) => {
        if (item.id !== itemId) return item;

        const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
        const extendedPrice = (quantity * unitCost).toString();

        return {
          ...item,
          quantity: quantity.toString(),
          extendedPrice,
        };
      });

      const next = {
        ...current,
        items,
      };

      return {
        ...next,
        materialTotal: recalculateMaterialTotal(next),
      };
    },
    { pendingSync: true },
  );
}

export function applyOfflineRemoveItem(materialListId: string, itemId: string) {
  return patchOfflineMaterialList(
    materialListId,
    (current) => {
      const next = {
        ...current,
        items: current.items.filter((item) => item.id !== itemId),
      };

      return {
        ...next,
        materialTotal: recalculateMaterialTotal(next),
      };
    },
    { pendingSync: true },
  );
}

export function applyOfflineRenameMaterialList(
  materialListId: string,
  name: string,
) {
  return patchOfflineMaterialList(
    materialListId,
    (current) => ({
      ...current,
      materialList: {
        ...current.materialList,
        name,
      },
    }),
    { pendingSync: true },
  );
}
