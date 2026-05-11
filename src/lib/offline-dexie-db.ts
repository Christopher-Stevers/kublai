import Dexie, { type Table } from "dexie";
import dexieCloud from "dexie-cloud-addon";
import { env } from "~/env";

const DB_NAME = "foremanhq-offline";

export interface OfflineDexieMaterialListRow<T = unknown> {
  id: string;
  value: T;
}

export interface OfflineDexieMetaRow<T = unknown> {
  key: string;
  value: T;
}

export interface OfflineDexieMutationRow<T = unknown> {
  id: string;
  order: number;
  materialListId: string;
  type: string;
  queuedAt: string;
  value: T;
}

export interface OfflineDexieEntityMutationRow<T = unknown> {
  id: string;
  order: number;
  entityType: "job" | "materialList";
  entityId: string;
  type: string;
  queuedAt: string;
  value: T;
}

export interface OfflineDexieActiveItemSyncRow {
  id: string;
  materialListId: string;
  itemId: string;
  status: "pending" | "syncing";
  updatedAt: number;
}

export interface OfflineDexieSyncingMaterialListRow {
  id: string;
  updatedAt?: number;
}

export interface DexieMaterialListHeaderRow {
  id: string;
  name: string;
  jobId: string;
  jobName: string;
  quoteId: string | null;
  materialTotal: number;
  pendingSync: boolean;
  pendingDeletedItemIds: string[];
  updatedAt: string;
  serverUpdatedAt: string | null;
  syncVersion: string | null;
}

export interface DexieMaterialListItemRow {
  id: string;
  materialListId: string;
  quantity: string;
  unitCost: string | null;
  extendedPrice: string | null;
  descriptionSnapshot: string | null;
  partDefinitionId: string | null;
  partDefinitionDisplayName: string | null;
  supplierPartId: string | null;
  selectedSupplierId: string | null;
  updatedAt: string | null;
  syncVersion: string | null;
  value: unknown;
}

export interface DexieJobSummaryRow<T = unknown> {
  id: string;
  name: string;
  locationId: string | null;
  status: string | null;
  createdAt: string;
  updatedAt: string;
  value: T;
}

export interface DexieJobDetailRow<T = unknown> {
  id: string;
  updatedAt: string;
  value: T;
}

export interface DexieSupplierRow<T = unknown> {
  id: string;
  name: string;
  locationId: string | null;
  updatedAt: string;
  value: T;
}

class ForemanHqOfflineDb extends Dexie {
  materialLists!: Table<OfflineDexieMaterialListRow, string>;
  meta!: Table<OfflineDexieMetaRow, string>;
  mutationQueue!: Table<OfflineDexieMutationRow, string>;
  entityMutationQueue!: Table<OfflineDexieEntityMutationRow, string>;
  activeItemSync!: Table<OfflineDexieActiveItemSyncRow, string>;
  syncingMaterialLists!: Table<OfflineDexieSyncingMaterialListRow, string>;
  materialListHeaders!: Table<DexieMaterialListHeaderRow, string>;
  materialListItems!: Table<DexieMaterialListItemRow, string>;
  jobSummaries!: Table<DexieJobSummaryRow, string>;
  jobDetails!: Table<DexieJobDetailRow, string>;
  suppliers!: Table<DexieSupplierRow, string>;

  constructor() {
    super(DB_NAME, { addons: [dexieCloud] });

    this.version(1).stores({
      materialLists: "id",
      meta: "key",
    });

    this.version(2).stores({
      materialLists: "id",
      meta: "key",
      mutationQueue: "id, order, materialListId, type, queuedAt",
      activeItemSync: "id, materialListId, itemId, status, updatedAt",
      syncingMaterialLists: "id",
    });

    this.version(3).stores({
      materialLists: "id",
      meta: "key",
      mutationQueue: "id, order, materialListId, type, queuedAt",
      activeItemSync: "id, materialListId, itemId, status, updatedAt",
      syncingMaterialLists: "id",
      materialListHeaders: "id, jobId, quoteId, pendingSync, updatedAt",
      materialListItems:
        "id, materialListId, partDefinitionId, supplierPartId, selectedSupplierId, updatedAt",
    });

    this.version(4).stores({
      materialLists: "id",
      meta: "key",
      mutationQueue: "id, order, materialListId, type, queuedAt",
      activeItemSync: "id, materialListId, itemId, status, updatedAt",
      syncingMaterialLists: "id",
      materialListHeaders: "id, jobId, quoteId, pendingSync, updatedAt",
      materialListItems:
        "id, materialListId, partDefinitionId, supplierPartId, selectedSupplierId, updatedAt",
      jobSummaries: "id, locationId, status, createdAt, updatedAt",
      jobDetails: "id, updatedAt",
    });

    this.version(5).stores({
      materialLists: "id",
      meta: "key",
      mutationQueue: "id, order, materialListId, type, queuedAt",
      activeItemSync: "id, materialListId, itemId, status, updatedAt",
      syncingMaterialLists: "id",
      materialListHeaders: "id, jobId, quoteId, pendingSync, updatedAt",
      materialListItems:
        "id, materialListId, partDefinitionId, supplierPartId, selectedSupplierId, updatedAt",
      jobSummaries: "id, locationId, status, createdAt, updatedAt",
      jobDetails: "id, updatedAt",
      suppliers: "id, name, locationId, updatedAt",
    });

    this.version(6).stores({
      materialLists: "id",
      meta: "key",
      mutationQueue: "id, order, materialListId, type, queuedAt",
      entityMutationQueue: "id, order, entityType, entityId, type, queuedAt",
      activeItemSync: "id, materialListId, itemId, status, updatedAt",
      syncingMaterialLists: "id",
      materialListHeaders: "id, jobId, quoteId, pendingSync, updatedAt",
      materialListItems:
        "id, materialListId, partDefinitionId, supplierPartId, selectedSupplierId, updatedAt",
      jobSummaries: "id, locationId, status, createdAt, updatedAt",
      jobDetails: "id, updatedAt",
      suppliers: "id, name, locationId, updatedAt",
    });

    if (env.NEXT_PUBLIC_DEXIE_CLOUD_DATABASE_URL) {
      this.cloud.configure({
        databaseUrl: env.NEXT_PUBLIC_DEXIE_CLOUD_DATABASE_URL,
        requireAuth: false,
      });
    }
  }
}

let dbInstance: ForemanHqOfflineDb | null = null;

export function canUseOfflineDexie() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export function getOfflineDexieDb() {
  if (!canUseOfflineDexie()) return null;
  dbInstance ??= new ForemanHqOfflineDb();
  return dbInstance;
}

export async function closeOfflineDexieDb() {
  dbInstance?.close();
  dbInstance = null;
}
