"use client";

import type { SentMaterialOrder } from "~/components/materialLists/SentMaterialStatus";
import { purchaseLineTotal, purchaseQuantity } from "~/lib/purchase-quantity";

import { useEffect, useMemo, useState } from "react";
import {
  subscribeToMaterialListReplicacheSyncing,
  tryGetMaterialListReplicache,
} from "~/lib/replicache-material-list";
import { createSharedReplicacheReader } from "./use-shared-replicache";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";

export type ReplicacheSyncStatus = "synced" | "pending" | "syncing";

export function resolveReplicacheSyncStatus(
  pendingSync: boolean | undefined,
  isSyncing: boolean,
): ReplicacheSyncStatus {
  if (!pendingSync) return "synced";
  return isSyncing ? "syncing" : "pending";
}

export function useReplicacheSyncing() {
  const sandbox = useTutorialSandbox();
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (sandbox) return;
    return subscribeToMaterialListReplicacheSyncing(setIsSyncing);
  }, [sandbox]);

  return sandbox ? false : isSyncing;
}

export interface ReplicacheMaterialListItem {
  sentOrderItemId?: string | null;
  sentOrder?: SentMaterialOrder | null;
  id: string;
  materialListId: string | null;
  roomId?: string | null;
  roomName?: string | null;
  quoteId: string | null;
  quantity: string;
  orderQuantity?: string;
  unitCost: string | null;
  extendedPrice: string | null;
  descriptionSnapshot: string | null;
  partDefinitionId: string | null;
  supplierPartId: string | null;
  supplierId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  pendingSync?: boolean;
  // Snapshot fields written by addItem mutator for immediate display
  partDefinition?: {
    id: string;
    displayName: string;
    assetTracking?: string | null;
    piecesPerPack?: number | null;
    bulkUnit?: string | null;
    individualUnit?: string | null;
    imageUrl: string | null;
    material: string | null;
  } | null;
  supplierPart?: {
    id: string;
    supplierId: string;
    supplierSku: string | null;
    lastKnownUnitCost: string | null;
    packSize?: string | null;
    supplier: { id: string; name: string } | null;
  } | null;
  addedBy?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
}

export interface ReplicacheMaterialList {
  id: string;
  roomId?: string | null;
  roomName?: string | null;
  name: string;
  /** materials (default) | tools: a tool request for the tool room. */
  kind?: "materials" | "tools";
  jobId: string;
  quoteId: string | null;
  createdAt: string;
  updatedAt: string;
  pendingSync?: boolean;
}

const EMPTY_DETAIL = {
  materialList: null as ReplicacheMaterialList | null,
  items: [] as ReplicacheMaterialListItem[],
  materialTotal: 0,
  isLoading: true,
};
export function useReplicacheMaterialList(materialListId: string) {
  const sandbox = useTutorialSandbox();
  const useReader = useMemo(
    () =>
      createSharedReplicacheReader(async (tx) => {
        const materialList = ((await tx.get(
          `materialList/${materialListId}`,
        )) ?? null) as unknown as ReplicacheMaterialList | null;
        if (!materialList) return { ...EMPTY_DETAIL, isLoading: false };
        const byList = (await tx
          .scan({ indexName: "itemsByList", prefix: materialListId })
          .values()
          .toArray()) as unknown as ReplicacheMaterialListItem[];
        const byQuote = materialList.quoteId
          ? ((await tx
              .scan({ indexName: "itemsByQuote", prefix: materialList.quoteId })
              .values()
              .toArray()) as unknown as ReplicacheMaterialListItem[])
          : [];
        const items = [
          ...new Map(
            [...byList, ...byQuote]
              .filter(
                (item) =>
                  item.materialListId === materialListId ||
                  (!item.materialListId &&
                    item.quoteId === materialList.quoteId),
              )
              .map((item) => [item.id, item]),
          ).values(),
        ];
        const pricedItems = items.map((item) => ({
          ...item,
          orderQuantity: String(
            purchaseQuantity(item.quantity, item.supplierPart?.packSize, item.partDefinition?.piecesPerPack),
          ),
          extendedPrice: item.sentOrderItemId ? item.extendedPrice : String(
            purchaseLineTotal(
              item.quantity,
              item.unitCost,
              item.supplierPart?.packSize,
              item.partDefinition?.piecesPerPack,
            ),
          ),
        }));
        pricedItems.sort(
          (a, b) =>
            Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""),
        );
        return {
          materialList,
          items: pricedItems,
          materialTotal: pricedItems.reduce(
            (sum, item) => sum + Number(item.extendedPrice ?? 0),
            0,
          ),
          isLoading: false,
        };
      }, EMPTY_DETAIL),
    [materialListId],
  );
  return useReader(sandbox?.material ?? tryGetMaterialListReplicache());
}
