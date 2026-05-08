const FOREMENHQ_STORAGE_PREFIXES = [
  "foremanhq.",
  "foremenhq.",
];

const FOREMENHQ_CACHE_PREFIXES = [
  "foremenhq-",
  "foremanhq-",
];

const FOREMENHQ_INDEXED_DB_NAMES = ["foremanhq-offline"];

function clearForemenhqLocalStorage() {
  if (typeof window === "undefined") return;

  const keysToRemove: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;

    if (FOREMENHQ_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }
}

async function clearForemenhqCaches() {
  if (typeof window === "undefined" || !("caches" in window)) return;

  const cacheNames = await window.caches.keys();
  await Promise.all(
    cacheNames
      .filter((cacheName) =>
        FOREMENHQ_CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix)),
      )
      .map((cacheName) => window.caches.delete(cacheName)),
  );
}

async function deleteIndexedDb(name: string) {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;

  await new Promise<void>((resolve) => {
    const request = window.indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function clearForemenhqIndexedDb() {
  await Promise.all(FOREMENHQ_INDEXED_DB_NAMES.map((name) => deleteIndexedDb(name)));
}

export async function clearForemenhqClientState() {
  clearForemenhqLocalStorage();
  await Promise.all([clearForemenhqCaches(), clearForemenhqIndexedDb()]);
}
