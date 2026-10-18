import { isTileManifest, tileBase } from "./drawing-tiles";
import { sourcePdfPage } from "./pdf-client";

/** Private drawing downloads are isolated from the service worker's shared caches. */
export const DRAWING_OFFLINE_BUDGET = 128 * 1024 * 1024;
const DATABASE = "foremanhq-drawing-downloads-v1";
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
export const DRAWING_OFFLINE_SNAPSHOT_BUDGET = 32 * 1024 * 1024;
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
      activeAccount = null;
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
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      for (const name of ["assets", "snapshots"]) {
        const store = request.result.createObjectStore(name, {
          keyPath: ["account", name === "assets" ? "url" : "key"],
        });
        store.createIndex("account", "account");
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
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

/** Bind only a server-validated account (org:user); null on logout, never infer it from a cache. */
export async function setDrawingOfflineAccount(accountKey: string | null) {
  accountSignals();
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
  bindingChanged();
  for (const store of stores)
    if (store.accountKey !== accountKey) store.dispose();
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  const tx = db.transaction(["assets", "snapshots"], "readwrite"),
    complete = done(tx);
  for (const name of ["assets", "snapshots"]) {
    const cursor = tx.objectStore(name).openCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      // Consult the latest binding: a slow logout cleanup must not erase the
      // new user's downloads if they sign in while IndexedDB opens.
      const item = cursor.result.value as Asset | Snapshot;
      if (item.account !== activeAccount) cursor.result.delete();
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
  async readAsset(url: string): Promise<Blob | null> {
    this.assertActive();
    const generation = this.generation;
    const db = await openDatabase();
    const item = (await result(
      db
        .transaction("assets", "readonly")
        .objectStore("assets")
        .get([this.accountKey, assetPath(url)]),
    )) as Asset | undefined;
    this.assertActive(generation);
    return item?.blob ?? null;
  }
  async resolveAssetUrl(url: string): Promise<string> {
    this.assertActive();
    const generation = this.generation;
    const key = assetPath(url),
      cached = this.urls.get(key);
    if (cached) return cached;
    const blob = await this.readAsset(key);
    if (!blob) return url;
    this.assertActive(generation);
    const raced = this.urls.get(key);
    if (raced) return raced;
    const objectUrl = URL.createObjectURL(blob);
    this.urls.set(key, objectUrl);
    return objectUrl;
  }
  async summary() {
    this.assertActive();
    const db = await openDatabase();
    const records = (await result(
      db
        .transaction("assets", "readonly")
        .objectStore("assets")
        .index("account")
        .getAll(this.accountKey),
    )) as Asset[];
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
        const response = await fetch(url, {
          credentials: "same-origin",
          cache: "no-store",
          signal,
        });
        if (!response.ok)
          throw new Error(
            `Could not save a drawing (${response.status}). Reconnect and try again.`,
          );
        if (Number(response.headers.get("content-length")) > available) {
          await response.body?.cancel();
          throw new Error(
            "This download exceeds the offline storage limit. Save fewer sheets or remove earlier downloads.",
          );
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let bytes = 0;
        if (!reader)
          throw new Error(
            "This browser cannot download drawings for offline use.",
          );
        try {
          while (true) {
            signal.throwIfAborted();
            this.assertActive(generation);
            const item = await reader.read();
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
        signal.throwIfAborted();
        this.assertActive(generation);
        const blob = new Blob(chunks, {
          type:
            response.headers.get("content-type") ?? "application/octet-stream",
        });
        const db = await openDatabase();
        const tx = db.transaction("assets", "readwrite"),
          complete = done(tx),
          store = tx.objectStore("assets");
        // Sum and write inside the same transaction: concurrent tabs cannot
        // both consume the same remaining byte budget.
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
    if (bytes > 10 * 1024 * 1024)
      throw new Error(
        "This drawing workspace is too large for an offline snapshot.",
      );
    const db = await openDatabase();
    this.assertActive(generation);
    const tx = db.transaction("snapshots", "readwrite"),
      complete = done(tx);
    const store = tx.objectStore("snapshots");
    const existing = store.index("account").getAll(this.accountKey);
    let quotaError: Error | undefined;
    existing.onsuccess = () => {
      try {
        this.assertActive(generation);
        const others = (existing.result as Snapshot[]).filter(
          (item) => item.key !== key,
        );
        const used = others.reduce(
          (total, item) =>
            total +
            (item.bytes ??
              new TextEncoder().encode(JSON.stringify(item.value)).byteLength),
          0,
        );
        if (
          others.length >= 512 ||
          used + bytes > DRAWING_OFFLINE_SNAPSHOT_BUDGET
        ) {
          quotaError = new Error(
            "Saved drawing workspaces exceed this device's offline limit. Remove saved drawings before saving more.",
          );
          tx.abort();
          return;
        }
        store.put({
          account: this.accountKey,
          key,
          value,
          bytes,
          savedAt: Date.now(),
        } satisfies Snapshot);
      } catch {
        tx.abort();
      }
    };
    await complete.catch((error: unknown) => {
      throw quotaError ?? error;
    });
    if (key.startsWith("drawing-download:") || key.startsWith("sheet-download:"))
      window.dispatchEvent(new Event("foremanhq-drawing-downloads-changed"));
  }
  async readSnapshot<T>(key: string): Promise<T | null> {
    this.assertActive();
    const generation = this.generation;
    const db = await openDatabase();
    const item = (await result(
      db
        .transaction("snapshots", "readonly")
        .objectStore("snapshots")
        .get([this.accountKey, key]),
    )) as Snapshot | undefined;
    this.assertActive(generation);
    return (item?.value as T | undefined) ?? null;
  }
  async clear() {
    this.assertActive();
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    const db = await openDatabase();
    this.assertActive();
    const tx = db.transaction(["assets", "snapshots"], "readwrite"),
      complete = done(tx);
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
    await complete;
    window.dispatchEvent(new Event("foremanhq-drawing-downloads-changed"));
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    stores.delete(this);
  }
}
