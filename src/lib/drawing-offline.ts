import { captureDrawingKeptAuthority, clearKeptDrawings, setDrawingKeptAccount } from "./drawing-kept";
import { registerLocalPdf, releaseLocalPdf } from "./pdf-range-source";
import { isTileManifest, tileBase } from "./drawing-tiles";
import { sourcePdfPage } from "./pdf-client";

/** Private drawing downloads are isolated from the service worker's shared caches. */
export const DRAWING_OFFLINE_BUDGET = 128 * 1024 * 1024;
const DATABASE = "foremanhq-drawing-downloads-v1";
/** Waits between tries when a drawing download drops part way. */
const SAVE_RETRY_MS = [1000, 3000, 8000];
type Asset = {
  account: string;
  url: string;
  blob: Blob;
  bytes: number;
  savedAt: number;
};
type Snapshot = {
  account: string;
  key: string;
  value: unknown;
  savedAt: number;
  bytes?: number;
};
export type DrawingOfflineProgress = {
  completed: number;
  total: number;
  bytes: number;
  url: string;
};
export type DrawingOfflineSaveOptions = {
  budgetBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DrawingOfflineProgress) => void;
};
let database: Promise<IDBDatabase> | undefined;
let activeAccount: string | null = null;
let activeEpoch = "";
let bindingGeneration = 0;
const stores = new Set<DrawingOfflineStore>();
export function isDrawingOfflineAccountActive(accountKey: string) {
  return activeAccount === accountKey;
}
function bindingChanged() {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("foremanhq-drawing-offline-binding-change", {
        detail: { accountKey: activeAccount },
      }),
    );
}
const ACCOUNT_SIGNAL = "foremanhq-drawing-account-signal-v1";
let listening = false;

function accountSignals() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== ACCOUNT_SIGNAL || !event.newValue) return;
    try {
      const message = JSON.parse(event.newValue) as { account?: unknown };
      if (
        message.account === activeAccount ||
        (message.account !== null && typeof message.account !== "string")
      )
        return;
      // A message from another tab can revoke access, never grant an account.
      bindingGeneration++;
      activeAccount = null;
      setDrawingKeptAccount(null);
      bindingChanged();
      for (const store of stores) store.dispose();
      window.dispatchEvent(new Event("foremanhq-drawing-account-invalidated"));
    } catch {
      /* Invalid messages cannot establish an identity. */
    }
  });
}

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("authority")) request.result.createObjectStore("authority");
      for (const name of ["assets", "snapshots"]) {
        if (request.result.objectStoreNames.contains(name)) continue;
        const store = request.result.createObjectStore(name, {
          keyPath: ["account", name === "assets" ? "url" : "key"],
        });
        store.createIndex("account", "account");
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () =>
      reject(
        request.error ?? new Error("Offline drawing storage is unavailable."),
      );
    request.onblocked = () =>
      reject(
        new Error("Close other ForemanHQ tabs to update offline storage."),
      );
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  return database;
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Offline storage failed."));
  });
}
function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("Offline storage is full or unavailable."));
  });
}
function assetPath(url: string) {
  const parsed = new URL(
    url,
    typeof window === "undefined"
      ? "https://foremanhq.invalid"
      : window.location.origin,
  );
  const origin =
    typeof window === "undefined"
      ? "https://foremanhq.invalid"
      : window.location.origin;
  // Only immutable PDF versions/pages, with an exact job binding. Never editor,
  // attachment, share-token or arbitrary document URLs.
  if (parsed.origin === origin && !parsed.hash &&
      /^\/api\/job-documents\/(?:pages\/[0-9a-f-]{36}\/[1-9]\d*|files\/[0-9a-f-]{36})$/i.test(parsed.pathname) &&
      /^\?jobId=[0-9a-f-]{36}$/i.test(parsed.search))
    return `${parsed.pathname}${parsed.search}`;
  if (
    parsed.origin !== origin ||
    parsed.search ||
    parsed.hash ||
    !/^\/api\/job-rooms\/files\/[a-zA-Z0-9_./-]+$/.test(parsed.pathname) ||
    parsed.pathname.includes("..")
  )
    throw new Error("Only this account's drawing files can be saved offline.");
  return parsed.pathname;
}

const DENIED_DRAWINGS = "foremanhq-denied-drawings-v1:";
const deniedAccounts = new Map<string, string>();
/** Delete by captured account, even after its live store has been disposed. */
export async function revokeDrawingOfflineAccount(owner: string) {
  const keptAuthority = captureDrawingKeptAuthority(owner);
  void keptAuthority.catch(() => undefined);
  const authority = activeAccount === owner ? Promise.resolve(activeEpoch) : typeof indexedDB === "undefined" ? Promise.resolve("") : openDatabase().then(db => result(db.transaction("authority").objectStore("authority").get(owner))).then((value: unknown) => typeof value === "string" ? value : "");
  const revocation = crypto.randomUUID();
  bindingGeneration++;
  deniedAccounts.set(owner, revocation);
  try { window.localStorage.setItem(DENIED_DRAWINGS + owner, revocation); } catch { /* Memory fence remains active. */ }
  try { window.localStorage.setItem(ACCOUNT_SIGNAL, JSON.stringify({account: null, nonce: crypto.randomUUID()})); } catch { /* Same-tab fencing still applies. */ }
  if (activeAccount === owner) {
    activeAccount = null;
    setDrawingKeptAccount(null);
    bindingChanged();
  }
  for (const store of stores) if (store.accountKey === owner) store.dispose();
  if (typeof indexedDB === "undefined") return;
  const expectedAuthority = await authority;
  const tx = (await openDatabase()).transaction(["assets", "snapshots", "authority"], "readwrite");
  const complete = done(tx);
  const fence = tx.objectStore("authority").get(owner);
  fence.onsuccess = () => {
    if ((fence.result ?? "") !== expectedAuthority) return;
    tx.objectStore("authority").put(crypto.randomUUID(), owner);
    for (const name of ["assets", "snapshots"]) {
      const cursor = tx.objectStore(name).index("account").openCursor(owner);
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        cursor.result.delete();
        cursor.result.continue();
      };
    }
  };
  await complete;
  await clearKeptDrawings(owner, true, await keptAuthority);
  if (deniedAccounts.get(owner) === revocation) deniedAccounts.delete(owner);
  try { if (window.localStorage.getItem(DENIED_DRAWINGS + owner) === revocation) window.localStorage.removeItem(DENIED_DRAWINGS + owner); } catch { /* A retained marker only repeats the safe purge. */ }
}

/** Bind only a server-validated account (org:user); null on logout, never infer it from a cache. */
export async function setDrawingOfflineAccount(accountKey: string | null, preserveAccountKey?: string) {
  accountSignals();
  const binding = ++bindingGeneration;
  let denied = accountKey !== null && deniedAccounts.has(accountKey);
  try { denied ||= accountKey !== null && window.localStorage.getItem(DENIED_DRAWINGS + accountKey) !== null; } catch { /* Restricted storage. */ }
  if (accountKey && denied) {
    await revokeDrawingOfflineAccount(accountKey);
    // The purge itself advances the generation; any other binding wins.
    if (bindingGeneration !== binding + 1) return;
  }
  const expectedBinding = bindingGeneration;
  const epoch = accountKey && typeof indexedDB !== "undefined"
    ? (await result((await openDatabase()).transaction("authority").objectStore("authority").get(accountKey))) as string | undefined
    : undefined;
  if (expectedBinding !== bindingGeneration) return;
  activeEpoch = epoch ?? "";
  if (accountKey !== activeAccount && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        ACCOUNT_SIGNAL,
        JSON.stringify({ account: accountKey, nonce: crypto.randomUUID() }),
      );
    } catch {
      /* Restricted storage; same-tab revocation still applies. */
    }
  }
  activeAccount = accountKey;
  setDrawingKeptAccount(accountKey);
  // Keep normal account downloads on disk, but revoke all access immediately.
  // Simulation data is temporary and must not outlive its validated session.
  void preserveAccountKey;
  bindingChanged();
  for (const store of stores)
    if (store.accountKey !== accountKey) store.dispose();
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  const tx = db.transaction(["assets", "snapshots"], "readwrite"), complete = done(tx);
  for (const name of ["assets", "snapshots"]) {
    const cursor = tx.objectStore(name).openCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      const item = cursor.result.value as Asset | Snapshot;
      if (item.account.includes(":simulation:") && item.account !== activeAccount) cursor.result.delete();
      cursor.result.continue();
    };
  }
  await complete;
}

/** Optional tiles are an explicit choice; a shared source PDF is downloaded only once. */
export async function collectDrawingOfflineUrls(
  imageUrls: string[],
  options: { includeTiles?: boolean; signal?: AbortSignal } = {},
) {
  const urls = new Set<string>();
  for (const imageUrl of imageUrls) {
    options.signal?.throwIfAborted();
    urls.add(assetPath(imageUrl));
    const pdf = sourcePdfPage(imageUrl);
    if (pdf) urls.add(pdf.url);
    const base = tileBase(imageUrl);
    if (!options.includeTiles || !base) continue;
    const response = await fetch(`${base}/manifest.json`, {
      credentials: "same-origin",
      signal: options.signal,
    });
    if (!response.ok)
      throw new Error(
        "Sharp tiles are not ready for this sheet. Save without tiles or try again later.",
      );
    const manifest: unknown = await response.json();
    if (!isTileManifest(manifest))
      throw new Error("This drawing's tile list is invalid.");
    urls.add(`${base}/manifest.json`);
    for (const level of manifest.levels) {
      for (
        let row = 0;
        row < Math.ceil(level.height / manifest.tileSize);
        row++
      )
        for (
          let col = 0;
          col < Math.ceil(level.width / manifest.tileSize);
          col++
        ) {
          urls.add(`${base}/${level.factor}/${col}_${row}.webp`);
          if (urls.size > 30_000)
            throw new Error(
              "This folder has too many tiles for one download. Save smaller selections.",
            );
        }
    }
  }
  return [...urls];
}

export class DrawingOfflineStore {
  private authorityEpoch = activeEpoch;
  private disposed = false;
  private generation = 0;
  private urls = new Map<string, string>();
  private controllers = new Set<AbortController>();
  constructor(readonly accountKey: string) {
    if (!accountKey || accountKey !== activeAccount)
      throw new Error("Sign in before opening saved drawings.");
    stores.add(this);
  }
  private assertActive(generation = this.generation) {
    if (
      this.disposed ||
      this.accountKey !== activeAccount ||
      generation !== this.generation
    )
      throw new DOMException("The drawing account changed.", "AbortError");
  }
  private authorizeWrite(tx: IDBTransaction, write: () => void) {
    const generation = this.generation, epoch = this.authorityEpoch;
    const request = tx.objectStore("authority").get(this.accountKey);
    request.onsuccess = () => {
      if ((request.result ?? "") !== epoch) { tx.abort(); return; }
      try { this.assertActive(generation); write(); } catch { tx.abort(); }
    };
  }
  private async assertStoredAuthority() {
    const epoch: unknown = await result((await openDatabase()).transaction("authority").objectStore("authority").get(this.accountKey));
    if ((epoch ?? "") !== this.authorityEpoch) throw new DOMException("Drawing access was revoked", "AbortError");
    this.assertActive();
  }
  private async authorizedRead<T>(name: string, read: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    this.assertActive();
    const generation = this.generation, epoch = this.authorityEpoch;
    const tx = (await openDatabase()).transaction(["authority", name], "readonly");
    const complete = done(tx);
    let value: T | undefined;
    const authority = tx.objectStore("authority").get(this.accountKey);
    authority.onsuccess = () => {
      if ((authority.result ?? "") !== epoch) { tx.abort(); return; }
      const request = read(tx.objectStore(name));
      request.onsuccess = () => { value = request.result; };
    };
    await complete;
    this.assertActive(generation);
    return value as T;
  }
  async readAsset(url: string): Promise<Blob | null> {
    const key = assetPath(url);
    const item = await this.authorizedRead<Asset | undefined>("assets", store => store.get([this.accountKey, key]) as IDBRequest<Asset | undefined>);
    return item?.blob ?? null;
  }
  async resolveAssetUrl(url: string): Promise<string> {
    this.assertActive();
    const generation = this.generation;
    const key = assetPath(url),
      cached = this.urls.get(key);
    if (cached) {
      try { await this.assertStoredAuthority(); } catch (error) { this.dispose(); throw error; }
      return cached;
    }
    const blob = await this.readAsset(key);
    if (!blob) return url;
    this.assertActive(generation);
    const raced = this.urls.get(key);
    if (raced) return raced;
    const objectUrl = URL.createObjectURL(blob);
    this.urls.set(key, objectUrl);
    if (/\.pdf(?:\?|$)/i.test(key) || key.startsWith("/api/job-documents/files/")) registerLocalPdf(objectUrl, blob);
    return objectUrl;
  }
  async summary() {
    this.assertActive();
    const records = await this.authorizedRead<Asset[]>("assets", store => store.index("account").getAll(this.accountKey) as IDBRequest<Asset[]>);
    this.assertActive();
    return {
      files: records.length,
      bytes: records.reduce((sum, item) => sum + item.bytes, 0),
    };
  }
  async saveAssets(urls: string[], options: DrawingOfflineSaveOptions = {}) {
    this.assertActive();
    const generation = this.generation;
    const paths = [...new Set(urls.map(assetPath))];
    const budget = options.budgetBytes ?? DRAWING_OFFLINE_BUDGET;
    if (!Number.isFinite(budget) || budget <= 0)
      throw new Error("Choose a positive offline download limit.");
    const controller = new AbortController();
    this.controllers.add(controller);
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const signal = controller.signal;
    let completed = 0,
      downloaded = 0;
    try {
      for (const url of paths) {
        signal.throwIfAborted();
        this.assertActive(generation);
        if (await this.readAsset(url)) {
          completed++;
          options.onProgress?.({
            completed,
            total: paths.length,
            bytes: downloaded,
            url,
          });
          continue;
        }
        const available = budget - (await this.summary()).bytes;
        // A dropped connection resumes after the bytes that already arrived
        // instead of starting a large set again.
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let bytes = 0;
        let type = "application/octet-stream";
        let validator: string | null = null;
        let expected: number | null = null;
        let attempt = 0;
        for (;;) {
          signal.throwIfAborted();
          this.assertActive(generation);
          const before = bytes;
          let dropped: unknown = null;
          let response: Response | null = null;
          try {
            response = await fetch(url, {
              credentials: "same-origin",
              cache: "no-store",
              signal,
              ...(bytes > 0 && validator
                ? {
                    headers: {
                      Range: `bytes=${bytes}-`,
                      "If-Range": validator,
                    },
                  }
                : {}),
            });
          } catch (error) {
            if (signal.aborted) throw error;
            dropped = error;
          }
          if (response) {
            const resumed =
              response.status === 206 &&
              new RegExp(`^bytes ${bytes}-\\d+/\\d+$`).test(
                response.headers.get("content-range") ?? "",
              );
            if (bytes > 0 && !resumed) {
              // The file changed or ranges are not on offer: start it again.
              chunks.length = 0;
              bytes = 0;
              expected = null;
            }
            if (response.status >= 500 || response.status === 429) {
              await response.body?.cancel().catch(() => undefined);
              dropped = new Error(
                `Could not save a drawing (${response.status}). Reconnect and try again.`,
              );
            } else if (!response.ok) {
              await response.body?.cancel().catch(() => undefined);
              throw new Error(
                `Could not save a drawing (${response.status}). Reconnect and try again.`,
              );
            } else {
              const length = Number(response.headers.get("content-length"));
              if (length > available - bytes) {
                await response.body?.cancel();
                throw new Error(
                  "This download exceeds the offline storage limit. Save fewer sheets or remove earlier downloads.",
                );
              }
              if (bytes === 0) {
                type = response.headers.get("content-type") ?? type;
                validator = response.headers.get("etag");
                // A weak tag cannot vouch for a byte range.
                if (validator?.startsWith("W/")) validator = null;
              }
              if (response.headers.has("content-length") && length >= 0)
                expected = bytes + length;
              const reader = response.body?.getReader();
              if (!reader)
                throw new Error(
                  "This browser cannot download drawings for offline use.",
                );
              try {
                while (true) {
                  signal.throwIfAborted();
                  this.assertActive(generation);
                  let item: ReadableStreamReadResult<Uint8Array>;
                  try {
                    item = await reader.read();
                  } catch (error) {
                    if (signal.aborted) throw error;
                    dropped = error;
                    break;
                  }
                  if (item.done) break;
                  bytes += item.value.byteLength;
                  if (bytes > available)
                    throw new Error(
                      "This download exceeds the offline storage limit.",
                    );
                  chunks.push(new Uint8Array(item.value));
                  options.onProgress?.({
                    completed,
                    total: paths.length,
                    bytes: downloaded + bytes,
                    url,
                  });
                }
              } catch (error) {
                await reader.cancel().catch(() => undefined);
                throw error;
              } finally {
                reader.releaseLock();
              }
              // A connection that closed early can look like a clean end.
              if (!dropped && expected !== null && bytes < expected)
                dropped = new Error("The drawing download stopped early.");
            }
          }
          if (!dropped) break;
          // Progress earns a fresh set of retries.
          if (bytes > before) attempt = 0;
          const retry = SAVE_RETRY_MS[attempt++];
          if (retry === undefined)
            throw dropped instanceof Error
              ? dropped
              : new Error("Could not save a drawing. Reconnect and try again.");
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(done, retry);
            function done() {
              signal.removeEventListener("abort", stop);
              resolve();
            }
            function stop() {
              clearTimeout(timer);
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new DOMException("Aborted", "AbortError"),
              );
            }
            signal.addEventListener("abort", stop, { once: true });
          });
        }
        signal.throwIfAborted();
        this.assertActive(generation);
        const blob = new Blob(chunks, { type });
        const db = await openDatabase();
        const tx = db.transaction(["assets", "authority"], "readwrite"),
          complete = done(tx),
          store = tx.objectStore("assets");
        // Sum and write inside the same transaction: concurrent tabs cannot
        // both consume the same remaining byte budget.
        this.authorizeWrite(tx, () => {
        const existing = store.index("account").getAll(this.accountKey);
        existing.onsuccess = () => {
          try {
            signal.throwIfAborted();
            this.assertActive(generation);
            const records = existing.result as Asset[];
            const used = records
              .filter((item) => item.url !== url)
              .reduce((sum, item) => sum + item.bytes, 0);
            if (used + bytes > budget) {
              tx.abort();
              return;
            }
            store.put({
              account: this.accountKey,
              url,
              blob,
              bytes,
              savedAt: Date.now(),
            } satisfies Asset);
          } catch {
            tx.abort();
          }
        };
        });
        await complete;
        downloaded += bytes;
        completed++;
        options.onProgress?.({
          completed,
          total: paths.length,
          bytes: downloaded,
          url,
        });
      }
      return this.summary();
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }
  async saveSnapshot<T>(key: string, value: T) {
    this.assertActive();
    const generation = this.generation;
    const serialized = JSON.stringify(value);
    const bytes = new TextEncoder().encode(serialized).byteLength;
    const db = await openDatabase();
    this.assertActive(generation);
    const tx = db.transaction(["snapshots", "authority"], "readwrite");
    const complete = done(tx);
    // IndexedDB enforces the device's real quota. Arbitrary record/byte caps
    // prevented additional sets from being saved despite available storage.
    this.authorizeWrite(tx, () => tx.objectStore("snapshots").put({
      account: this.accountKey, key, value, bytes, savedAt: Date.now(),
    } satisfies Snapshot));
    await complete.catch((error: unknown) => {
      if (tx.error?.name === "QuotaExceededError")
        throw new Error("This device's browser storage is full. Free device storage or remove saved drawings, then retry.");
      throw error;
    });
    if (key.startsWith("drawing-download:") || key.startsWith("sheet-download:"))
      window.dispatchEvent(new Event("foremanhq-drawing-downloads-changed"));
  }
  async readSnapshot<T>(key: string): Promise<T | null> {
    const item = await this.authorizedRead<Snapshot | undefined>("snapshots", store => store.get([this.accountKey, key]) as IDBRequest<Snapshot | undefined>);
    return (item?.value as T | undefined) ?? null;
  }
  async clear() {
    const expectedEpoch = this.authorityEpoch;
    const keptAuthority = captureDrawingKeptAuthority(this.accountKey);
    void keptAuthority.catch(() => undefined);
    this.assertActive();
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    for (const url of this.urls.values()) { releaseLocalPdf(url); URL.revokeObjectURL(url); }
    this.urls.clear();
    const db = await openDatabase();
    this.assertActive();
    const tx = db.transaction(["assets", "snapshots", "authority"], "readwrite"),
      complete = done(tx);
    const nextEpoch = crypto.randomUUID();
    this.authorizeWrite(tx, () => {
    tx.objectStore("authority").put(nextEpoch, this.accountKey);
    for (const name of ["assets", "snapshots"]) {
      const cursor = tx
        .objectStore(name)
        .index("account")
        .openCursor(this.accountKey);
      cursor.onsuccess = () => {
        if (cursor.result) {
          cursor.result.delete();
          cursor.result.continue();
        }
      };
    }
    });
    await complete;
    this.authorityEpoch = nextEpoch;
    if (this.accountKey === activeAccount && activeEpoch === expectedEpoch) activeEpoch = nextEpoch;
    // Sheets kept from earlier visits go with the saved ones.
    await clearKeptDrawings(this.accountKey, true, await keptAuthority);
    window.dispatchEvent(new Event("foremanhq-drawing-downloads-changed"));
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    for (const url of this.urls.values()) { releaseLocalPdf(url); URL.revokeObjectURL(url); }
    this.urls.clear();
    stores.delete(this);
  }
}
