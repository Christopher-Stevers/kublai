/**
 * Sheets a person has opened stay on their device. The browser's own cache
 * forgets a drawing after an hour and gives nothing back without a signal, so
 * a sheet read in the trailer was downloaded again in the basement. A sheet's
 * PDF that has fully arrived is kept here, and the next visit reads it from
 * the device: no request, and sharp as soon as it is drawn.
 *
 * This is apart from the drawings someone chose to save offline (see
 * `drawing-offline.ts`): it has its own database and its own limit, and it
 * only ever removes its own oldest files. The rules of access are the same.
 * Files belong to one validated account, are unreadable the moment that
 * account is not the one signed in, and "Remove saved drawings" removes them.
 */
const DATABASE = "foremanhq-drawing-kept-v1";
/** Oldest sheets make room past this. About 400 sheets of typical size. */
export const DRAWING_KEPT_BUDGET = 256 * 1024 * 1024;
/** A file larger than this is a whole drawing set, never one sheet. */
export const DRAWING_KEPT_FILE = 16 * 1024 * 1024;
/** Only an upload's own PDF or one of its pages: immutable per upload. */
const FILE =
  /^\/api\/job-rooms\/files\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(?:plan\.pdf|pages\/[1-9]\d{0,4}\.pdf)$/i;

type Meta = { account: string; url: string; bytes: number; usedAt: number };
type Kept = { account: string; url: string; blob: Blob };

let account: string | null = null;
let database: Promise<IDBDatabase> | undefined;

/** Follows the drawing account (see `setDrawingOfflineAccount`); null locks
 * every file. A simulation's drawings are never kept. */
export function setDrawingKeptAccount(accountKey: string | null) {
  account =
    accountKey && !accountKey.includes(":simulation:") ? accountKey : null;
}

function keptPath(url: string) {
  if (typeof window === "undefined") return null;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin &&
      !parsed.search &&
      !parsed.hash &&
      FILE.test(parsed.pathname)
      ? parsed.pathname
      : null;
  } catch {
    return null;
  }
}

/** True when this file could be on the device for the signed-in account. */
export function mayKeepDrawing(url: string) {
  return (
    account !== null &&
    typeof indexedDB !== "undefined" &&
    keptPath(url) !== null
  );
}

function open() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      for (const name of ["files", "meta"])
        request.result
          .createObjectStore(name, { keyPath: ["account", "url"] })
          .createIndex("account", "account");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = request.onblocked = () =>
      reject(request.error ?? new Error("Device storage is unavailable."));
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  return database;
}
const result = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Device storage failed."));
  });
const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("Device storage failed."));
  });

/** Sizes of the files kept for this account, null for those that are not. */
export async function keptDrawingBytes(
  urls: string[],
): Promise<(number | null)[]> {
  const owner = account;
  const none = urls.map(() => null);
  if (!urls.some(mayKeepDrawing) || !owner) return none;
  try {
    const store = (await open())
      .transaction("meta", "readonly")
      .objectStore("meta");
    const found = await Promise.all(
      urls.map(async (url) => {
        const path = keptPath(url);
        if (!path) return null;
        const meta = (await result(store.get([owner, path]))) as
          | Meta
          | undefined;
        return meta ? meta.bytes : null;
      }),
    );
    return owner === account ? found : none;
  } catch {
    return none;
  }
}

/** The file as kept on this device for the signed-in account, or null. */
export async function readKeptDrawing(url: string): Promise<Blob | null> {
  const owner = account;
  const path = keptPath(url);
  if (!owner || !path || !mayKeepDrawing(url)) return null;
  try {
    const tx = (await open()).transaction(["files", "meta"], "readwrite");
    const complete = done(tx);
    const request = tx.objectStore("files").get([owner, path]);
    let kept: Kept | undefined;
    request.onsuccess = () => {
      kept = request.result as Kept | undefined;
      // Read sheets are the last to make room.
      if (kept)
        tx.objectStore("meta").put({
          account: owner,
          url: path,
          bytes: kept.blob.size,
          usedAt: Date.now(),
        } satisfies Meta);
    };
    await complete;
    return kept && owner === account ? kept.blob : null;
  } catch {
    return null;
  }
}

async function write(owner: string, path: string, blob: Blob) {
  const tx = (await open()).transaction(["files", "meta"], "readwrite");
  const complete = done(tx);
  tx.objectStore("files").put({
    account: owner,
    url: path,
    blob,
  } satisfies Kept);
  tx.objectStore("meta").put({
    account: owner,
    url: path,
    bytes: blob.size,
    usedAt: Date.now(),
  } satisfies Meta);
  await complete;
}

/** Removes the least recently read files, of any account, down to `budget`. */
async function trim(budget: number) {
  const db = await open();
  const all = (await result(
    db.transaction("meta", "readonly").objectStore("meta").getAll(),
  )) as Meta[];
  let total = all.reduce((sum, meta) => sum + meta.bytes, 0);
  if (total <= budget) return;
  const tx = db.transaction(["files", "meta"], "readwrite");
  const complete = done(tx);
  for (const meta of all.sort((a, b) => a.usedAt - b.usedAt)) {
    if (total <= budget) break;
    total -= meta.bytes;
    tx.objectStore("files").delete([meta.account, meta.url]);
    tx.objectStore("meta").delete([meta.account, meta.url]);
  }
  await complete;
}

/** Keeps a complete, immutable drawing file for the signed-in account.
 * Never throws: a full or private-mode device simply keeps nothing. */
export async function keepDrawing(
  url: string,
  blob: Blob,
  budget = DRAWING_KEPT_BUDGET,
) {
  const owner = account;
  const path = keptPath(url);
  if (!owner || !path || !mayKeepDrawing(url)) return false;
  if (!blob.size || blob.size > DRAWING_KEPT_FILE || blob.size > budget)
    return false;
  try {
    await write(owner, path, blob).catch(async (error: unknown) => {
      // A full device: the oldest half makes room, once.
      if ((error as { name?: unknown } | null)?.name !== "QuotaExceededError")
        throw error;
      await trim(budget / 2);
      await write(owner, path, blob);
    });
    await trim(budget);
    return true;
  } catch {
    return false;
  }
}

/** Removes every file kept for the signed-in account. */
export async function clearKeptDrawings() {
  const owner = account;
  if (!owner || typeof indexedDB === "undefined") return;
  try {
    const tx = (await open()).transaction(["files", "meta"], "readwrite");
    const complete = done(tx);
    for (const name of ["files", "meta"]) {
      const cursor = tx.objectStore(name).index("account").openCursor(owner);
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        cursor.result.delete();
        cursor.result.continue();
      };
    }
    await complete;
  } catch {
    /* Nothing kept is nothing to remove. */
  }
}

export function resetDrawingKeptForTest() {
  account = null;
  database = undefined;
}
