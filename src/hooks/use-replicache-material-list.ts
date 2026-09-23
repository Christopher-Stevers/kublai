"use client";

import { useEffect, useState } from "react";
import {
  subscribeToMaterialListReplicacheSyncing,
} from "~/lib/replicache-material-list";
import { useReplicacheWorkspace } from "./use-replicache-jobs";

export type ReplicacheSyncStatus = "synced" | "pending" | "syncing";

export function resolveReplicacheSyncStatus(
  pendingSync: boolean | undefined,
  isSyncing: boolean,
): ReplicacheSyncStatus {
  if (!pendingSync) return "synced";
  return isSyncing ? "syncing" : "pending";
}

export function useReplicacheSyncing() {
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    return subscribeToMaterialListReplicacheSyncing(setIsSyncing);
  }, []);

  return isSyncing;
}

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
  addedBy?: {
    id: string;
    name: string | null;
    email: string | null;
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

const EMPTY_DETAIL = {
  materialList: null as ReplicacheMaterialList | null,
  items: [] as ReplicacheMaterialListItem[], materialTotal: 0, isLoading: true,
};
export function useReplicacheMaterialList(materialListId: string) {
  return useReplicacheWorkspace().lists[materialListId] ?? EMPTY_DETAIL;
}
