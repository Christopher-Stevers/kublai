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

class ForemanHqOfflineDb extends Dexie {
  materialLists!: Table<OfflineDexieMaterialListRow, string>;
  meta!: Table<OfflineDexieMetaRow, string>;

  constructor() {
    super(DB_NAME, { addons: [dexieCloud] });

    this.version(1).stores({
      materialLists: "id",
      meta: "key",
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
