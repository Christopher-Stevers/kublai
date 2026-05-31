"use client";

import { useCallback } from "react";
import { tryGetMaterialListReplicache } from "~/lib/replicache-material-list";
import { useReplicacheSubscribe } from "~/hooks/use-replicache-subscribe";

export type ReplicacheSyncStatus = "synced" | "pending" | "syncing";

export interface ReplicacheMaterialListItem {
  id: string;
  materialListId: string | null;
  quoteId: string | null;
  quantity: string;
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
    imageUrl: string | null;
    material: string | null;
  } | null;
  supplierPart?: {
    id: string;
    supplierId: string;
    supplierSku: string | null;
    lastKnownUnitCost: string | null;
    supplier: { id: string; name: string } | null;
  } | null;
}

export interface ReplicacheMaterialList {
  id: string;
  name: string;
  jobId: string;
  quoteId: string | null;
  createdAt: string;
  updatedAt: string;
  pendingSync?: boolean;
}

function isMaterialListRecord(value: unknown): value is ReplicacheMaterialList {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "id" in value &&
    "jobId" in value
  );
}

function isItemRecord(value: unknown): value is ReplicacheMaterialListItem {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "id" in value &&
    "quantity" in value
  );
}

export function useReplicacheMaterialList(materialListId: string) {
  const rep = tryGetMaterialListReplicache();

  const result = useReplicacheSubscribe(
    rep,
    useCallback(async (tx) => {
      const mlValue = await tx.get(`materialList/${materialListId}`);
      const materialList = isMaterialListRecord(mlValue) ? mlValue : null;

      if (!materialList) {
        return {
          materialList: null,
          items: [] as ReplicacheMaterialListItem[],
          materialTotal: 0,
          isLoading: true,
        };
      }

      const itemEntries = await tx.scan({ prefix: "materialListItem/" }).entries().toArray();
      const items: ReplicacheMaterialListItem[] = [];
      let materialTotal = 0;

      for (const [, value] of itemEntries) {
        if (
          isItemRecord(value) &&
          // items have materialListId set directly
          (value.materialListId === materialListId ||
            // fallback: items without materialListId that belong via quoteId match (server-side items before first pull)
            (!value.materialListId && mlValue && "quoteId" in (mlValue as object) &&
              (mlValue as { quoteId?: string | null }).quoteId &&
              value.quoteId === (mlValue as { quoteId?: string | null }).quoteId))
        ) {
          items.push(value);
          const price = value.extendedPrice ? parseFloat(String(value.extendedPrice)) : 0;
          materialTotal += Number.isFinite(price) ? price : 0;
        }
      }

      // Sort by createdAt ascending (insertion order)
      items.sort((a, b) => {
        if (!a.createdAt || !b.createdAt) return 0;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      return {
        materialList,
        items,
        materialTotal,
        isLoading: materialList === null,
      };
    }, [materialListId]),
    {
      default: {
        materialList: null as ReplicacheMaterialList | null,
        items: [] as ReplicacheMaterialListItem[],
        materialTotal: 0,
        isLoading: true,
      },
    },
  );

  return result;
}
