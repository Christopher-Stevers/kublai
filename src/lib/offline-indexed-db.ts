import { getOfflineDexieDb } from "~/lib/offline-dexie-db";

export async function idbGetMaterialList<T>(id: string) {
  const db = getOfflineDexieDb();
  if (!db) return null;

  const row = await db.materialLists.get(id);
  return (row?.value as T | undefined) ?? null;
}

export async function idbSetMaterialList<T>(id: string, value: T) {
  const db = getOfflineDexieDb();
  if (!db) return;

  await db.materialLists.put({ id, value });
}

export async function idbDeleteMaterialList(id: string) {
  const db = getOfflineDexieDb();
  if (!db) return;

  await db.materialLists.delete(id);
}

export async function idbGetMaterialListIds() {
  const db = getOfflineDexieDb();
  if (!db) return [] as string[];

  return db.materialLists.toCollection().primaryKeys((keys) => keys.map(String));
}

export async function idbGetMeta<T>(key: string, fallback: T) {
  const db = getOfflineDexieDb();
  if (!db) return fallback;

  const row = await db.meta.get(key);
  return (row?.value as T | undefined) ?? fallback;
}

export async function idbSetMeta<T>(key: string, value: T) {
  const db = getOfflineDexieDb();
  if (!db) return;

  await db.meta.put({ key, value });
}

export async function idbDeleteMeta(key: string) {
  const db = getOfflineDexieDb();
  if (!db) return;

  await db.meta.delete(key);
}
