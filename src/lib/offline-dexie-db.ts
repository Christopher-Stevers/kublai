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

export interface OfflineDexieActiveItemSyncRow {
  id: string;
  materialListId: string;
  itemId: string;
  status: "pending" | "syncing";
  updatedAt: number;
}

export interface OfflineDexieSyncingMaterialListRow {
  id: string;
}

class ForemanHqOfflineDb extends Dexie {
  materialLists!: Table<OfflineDexieMaterialListRow, string>;
  meta!: Table<OfflineDexieMetaRow, string>;
  mutationQueue!: Table<OfflineDexieMutationRow, string>;
  activeItemSync!: Table<OfflineDexieActiveItemSyncRow, string>;
  syncingMaterialLists!: Table<OfflineDexieSyncingMaterialListRow, string>;

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
