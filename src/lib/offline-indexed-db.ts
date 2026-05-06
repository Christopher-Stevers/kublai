const DB_NAME = "foremanhq-offline";
const DB_VERSION = 1;

const MATERIAL_LIST_STORE = "materialLists";
const META_STORE = "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function canUseIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openOfflineDb() {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MATERIAL_LIST_STORE)) {
        db.createObjectStore(MATERIAL_LIST_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open offline IndexedDB"));
  });

  return dbPromise;
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T | null> {
  const db = await openOfflineDb();
  if (!db) return null;

  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let settled = false;

    tx.oncomplete = () => {
      if (!settled) resolve(null);
    };
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));

    try {
      const result = run(store);
      if (result instanceof IDBRequest) {
        result.onsuccess = () => {
          settled = true;
          resolve(result.result ?? null);
        };
        result.onerror = () => reject(result.error ?? new Error("IndexedDB request failed"));
      } else {
        void result.then((value) => {
          settled = true;
          resolve(value);
        }, reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

export async function idbGetMaterialList<T>(id: string) {
  const row = await withStore<{ id: string; value: T }>(
    MATERIAL_LIST_STORE,
    "readonly",
    (store) => store.get(id),
  );
  return row?.value ?? null;
}

export async function idbSetMaterialList<T>(id: string, value: T) {
  await withStore(MATERIAL_LIST_STORE, "readwrite", (store) =>
    store.put({ id, value }),
  );
}

export async function idbDeleteMaterialList(id: string) {
  await withStore(MATERIAL_LIST_STORE, "readwrite", (store) => store.delete(id));
}

export async function idbGetMaterialListIds() {
  const db = await openOfflineDb();
  if (!db) return [] as string[];

  return new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(MATERIAL_LIST_STORE, "readonly");
    const store = tx.objectStore(MATERIAL_LIST_STORE);
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result.map(String));
    request.onerror = () => reject(request.error ?? new Error("Failed to read material list ids"));
  });
}

export async function idbGetMeta<T>(key: string, fallback: T) {
  const row = await withStore<{ key: string; value: T }>(META_STORE, "readonly", (store) =>
    store.get(key),
  );
  return row?.value ?? fallback;
}

export async function idbSetMeta<T>(key: string, value: T) {
  await withStore(META_STORE, "readwrite", (store) => store.put({ key, value }));
}

export async function idbDeleteMeta(key: string) {
  await withStore(META_STORE, "readwrite", (store) => store.delete(key));
}
