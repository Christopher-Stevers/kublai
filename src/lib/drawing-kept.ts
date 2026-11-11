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
let bindingEpoch = 0;
let database: Promise<IDBDatabase> | undefined;
const authorities = new Map<string, Promise<number>>();

/** Follows the drawing account (see `setDrawingOfflineAccount`); null locks
 * every file. A simulation's drawings are never kept. */
export function setDrawingKeptAccount(accountKey: string | null) {
  bindingEpoch++;
  account =
    accountKey && !accountKey.includes(":simulation:") ? accountKey : null;
  if (account)
    authorities.set(
      account,
      readAuthority(account).catch(() => -1),
    );
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
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("authority"))
        request.result.createObjectStore("authority", { keyPath: "account" });
      for (const name of ["files", "meta"])
        if (!request.result.objectStoreNames.contains(name))
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

async function readAuthority(owner: string): Promise<number> {
  const tx = (await open()).transaction("authority", "readonly");
  const value = (await result(tx.objectStore("authority").get(owner))) as
    | { generation: number }
    | undefined;
  return value?.generation ?? 0;
}

/** Capture before awaiting a revocation. Never recapture a newer validated bind
 * when an old clear finally gets its turn. */
export function captureDrawingKeptAuthority(owner: string): Promise<number> {
  return authorities.get(owner) ?? readAuthority(owner);
}

function active(owner: string, epoch: number) {
  return owner === account && epoch === bindingEpoch;
}

/** Authority comparison and the protected operation share one IDB transaction,
 * so an unseen cross-tab revoke cannot be followed by a stale write. */
async function authorized(
  owner: string,
  generation: number,
  names: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => void,
) {
  const tx = (await open()).transaction(["authority", ...names], mode);
  const complete = done(tx);
  const request = tx.objectStore("authority").get(owner);
  request.onsuccess = () => {
    const current = request.result as { generation: number } | undefined;
    if (generation < 0 || (current?.generation ?? 0) !== generation) {
      tx.abort();
      return;
    }
    work(tx);
  };
  await complete;
}

/** Sizes of the files kept for this account, null for those that are not. */
export async function keptDrawingBytes(
  urls: string[],
): Promise<(number | null)[]> {
  const owner = account,
    epoch = bindingEpoch,
    none = urls.map(() => null);
  if (!urls.some(mayKeepDrawing) || !owner) return none;
  const authority = captureDrawingKeptAuthority(owner);
  try {
    const generation = await authority;
    if (!active(owner, epoch)) return none;
    const found: (number | null)[] = [...none];
    await authorized(owner, generation, ["meta"], "readonly", (tx) => {
      urls.forEach((url, index) => {
        const path = keptPath(url);
        if (!path) return;
        const request = tx.objectStore("meta").get([owner, path]);
        request.onsuccess = () => {
          found[index] = (request.result as Meta | undefined)?.bytes ?? null;
        };
      });
    });
    return active(owner, epoch) ? found : none;
  } catch {
    return none;
  }
}

/** The file as kept on this device for the signed-in account, or null. */
export async function readKeptDrawing(url: string): Promise<Blob | null> {
  const owner = account,
    epoch = bindingEpoch,
    path = keptPath(url);
  if (!owner || !path || !mayKeepDrawing(url)) return null;
  const authority = captureDrawingKeptAuthority(owner);
  try {
    const generation = await authority;
    if (!active(owner, epoch)) return null;
    let kept: Kept | undefined;
    await authorized(
      owner,
      generation,
      ["files", "meta"],
      "readwrite",
      (tx) => {
        const request = tx.objectStore("files").get([owner, path]);
        request.onsuccess = () => {
          kept = request.result as Kept | undefined;
          if (kept)
            tx.objectStore("meta").put({
              account: owner,
              url: path,
              bytes: kept.blob.size,
              usedAt: Date.now(),
            } satisfies Meta);
        };
      },
    );
    return kept && active(owner, epoch) ? kept.blob : null;
  } catch {
    return null;
  }
}

async function write(
  owner: string,
  path: string,
  blob: Blob,
  epoch: number,
  generation: number,
) {
  if (!active(owner, epoch)) throw new Error("Drawing account changed");
  await authorized(owner, generation, ["files", "meta"], "readwrite", (tx) => {
    if (!active(owner, epoch)) {
      tx.abort();
      return;
    }
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
  });
}

/** Budget eviction is fenced too: an old writer cannot trim a fresh binding. */
async function trim(
  budget: number,
  owner: string,
  epoch: number,
  generation: number,
) {
  if (!active(owner, epoch)) throw new Error("Drawing account changed");
  await authorized(owner, generation, ["files", "meta"], "readwrite", (tx) => {
    if (!active(owner, epoch)) {
      tx.abort();
      return;
    }
    const request = tx.objectStore("meta").getAll();
    request.onsuccess = () => {
      const all = request.result as Meta[];
      let total = all.reduce((sum, meta) => sum + meta.bytes, 0);
      for (const meta of all.sort((a, b) => a.usedAt - b.usedAt)) {
        if (total <= budget) break;
        total -= meta.bytes;
        tx.objectStore("files").delete([meta.account, meta.url]);
        tx.objectStore("meta").delete([meta.account, meta.url]);
      }
    };
  });
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
  const epoch = bindingEpoch;
  if (!owner || !path || !mayKeepDrawing(url)) return false;
  if (!blob.size || blob.size > DRAWING_KEPT_FILE || blob.size > budget)
    return false;
  const authority = captureDrawingKeptAuthority(owner);
  try {
    const generation = await authority;
    await write(owner, path, blob, epoch, generation).catch(
      async (error: unknown) => {
        // A full device: the oldest half makes room, once.
        if ((error as { name?: unknown } | null)?.name !== "QuotaExceededError")
          throw error;
        await trim(budget / 2, owner, epoch, generation);
        await write(owner, path, blob, epoch, generation);
      },
    );
    await trim(budget, owner, epoch, generation);
    return true;
  } catch {
    return false;
  }
}

/** Removes every file kept for the signed-in account. */
export async function clearKeptDrawings(
  owner: string | null = account,
  strict = false,
  expectedGeneration?: number,
) {
  if (!owner || typeof indexedDB === "undefined") return;
  const epoch = bindingEpoch;
  let advanced: number | undefined;
  const captured =
    expectedGeneration === undefined
      ? captureDrawingKeptAuthority(owner)
      : Promise.resolve(expectedGeneration);
  try {
    const generation = await captured;
    if (generation < 0) throw new Error("Kept drawing authority is unavailable.");
    const tx = (await open()).transaction(
      ["authority", "files", "meta"],
      "readwrite",
    );
    const complete = done(tx);
    const authority = tx.objectStore("authority").get(owner);
    authority.onsuccess = () => {
      const current =
        (authority.result as { generation: number } | undefined)?.generation ??
        0;
      // A late denial or clear must not erase a newer generation's data.
      if (generation < 0 || current !== generation) return;
      advanced = current + 1;
      tx.objectStore("authority").put({
        account: owner,
        generation: advanced,
      });
      for (const name of ["files", "meta"]) {
        const cursor = tx.objectStore(name).index("account").openCursor(owner);
        cursor.onsuccess = () => {
          if (!cursor.result) return;
          cursor.result.delete();
          cursor.result.continue();
        };
      }
    };
    await complete;
    // A user clear keeps this binding usable for new work. Already-captured
    // operations and other contexts retain their old generation and stay fenced.
    if (advanced !== undefined && active(owner, epoch))
      authorities.set(owner, Promise.resolve(advanced));
  } catch (error) {
    if (strict) throw error;
  }
}

export function resetDrawingKeptForTest() {
  account = null;
  bindingEpoch++;
  authorities.clear();
  database = undefined;
}
