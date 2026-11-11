import {
  dehydrate,
  hydrate,
  type Query,
  type QueryClient,
  type DehydratedState,
} from "@tanstack/react-query";
import SuperJSON from "superjson";
import { isInstantQueryPending } from "./instant-query-update";

export const DEVICE_QUERY_VERSION = 2;
export const DEVICE_QUERY_DENIED_EVENT = "foremanhq-device-read-denied";
export const DEVICE_QUERY_BUDGET = 20 * 1024 * 1024;
const DATABASE = "foremanhq-device-queries";
const STORE = "cache";
// Deliberately opt in reviewed reads; new endpoints (including payments,
// permissions, chat and private document contents) are never persisted by default.
const READS = new Set([
  "job.getJob",
  "job.previewSupplierDefault",
  "job.supplierDefaultOptions",
  "drawings.listSets",
  "drawings.getSet",
  "rooms.getJobRooms",
  "rooms.getJobRoomCount",
  "assets.overview",
  "assets.holders",
  "assets.listTypes",
  "assets.listAssets",
  "assets.listStock",
  "assets.getAsset",
  "assets.holdings",
  "assets.activity",
]);
// Authority reads may revoke separate drawing snapshots without being persisted.
const AUTHORITY_READS = new Set([...READS, "drawingsWorkspace.get", "drawingsWorkspace.list", "drawingsWorkspace.changes"]);
function reviewedAuthorityRead(query: Pick<Query, "queryKey">) {
  const path = query.queryKey[0];
  return Array.isArray(path) && AUTHORITY_READS.has(path.join("."));
}
function reviewedDeviceRead(query: Pick<Query, "queryKey">) {
  const path = query.queryKey[0];
  return Array.isArray(path) && READS.has(path.join("."));
}
function denialCode(error: unknown, depth = 0): unknown {
  if (depth > 2 || !error || typeof error !== "object") return undefined;
  const record = error as {cause?: unknown; code?: unknown; data?: {code?: unknown; httpStatus?: unknown}; shape?: {data?: {code?: unknown; httpStatus?: unknown}}};
  const data = record.data ?? record.shape?.data;
  return data?.code ?? (record.code === "UNKNOWN" ? undefined : record.code) ?? data?.httpStatus ?? (record.cause !== error ? denialCode(record.cause, depth + 1) : undefined);
}
let currentReadAuthority: object | null = null;
export const captureDeviceReadAuthority = () => currentReadAuthority;
export function reportDeviceReadDenial(path: string, type: string, error: unknown, expectedAuthority = currentReadAuthority) {
  if (expectedAuthority !== currentReadAuthority) return false;
  if (type !== "query" || !AUTHORITY_READS.has(path) || !isDeviceReadDenial(error)) return false;
  for (const session of [...activeCaches]) void session.stop(true);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DEVICE_QUERY_DENIED_EVENT, {detail: {drawings: denialRevokesDrawings({queryKey: [path.split(".")]}, error)}}));
  return true;
}
export function isDeviceReadDenial(error: unknown) {
  return ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "SIGNED_OUT", 401, 403, 404, 410].includes(denialCode(error) as string | number);
}
export function denialRevokesDrawings(query: Pick<Query, "queryKey">, error: unknown) {
  const path = query.queryKey[0];
  // A deleted asset is not evidence that unrelated saved drawings were revoked.
  const deleted = ["NOT_FOUND", 404, 410].includes(denialCode(error) as string | number);
  return !(deleted && Array.isArray(path) && path[0] === "assets");
}
export function shouldPersistDeviceQuery(
  query: Pick<Query, "queryKey" | "state" | "meta">,
) {
  const acknowledged = query.state.status === "success" ||
    (query.state.status === "error" && query.state.dataUpdatedAt > 0 && query.state.data !== undefined && !isDeviceReadDenial(query.state.error));
  return !isInstantQueryPending(query) && query.meta?.persist !== false && acknowledged && reviewedDeviceRead(query);
}
const ENCODED_QUERY_FORMAT = "device-query-entries-v2";
interface EncodedQueries {
  format: typeof ENCODED_QUERY_FORMAT;
  mutations: [];
  queries: ReturnType<typeof SuperJSON.serialize>[];
}
// Each query has its own SuperJSON metadata. This avoids serializing every
// previously retained query again merely to test the next candidate's size.
export function encodeDeviceQueries(
  client: QueryClient,
  budget = DEVICE_QUERY_BUDGET,
) {
  const state = dehydrate(client, {
    shouldDehydrateQuery: shouldPersistDeviceQuery,
    shouldDehydrateMutation: () => false,
  });
  state.queries.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  const prefix = `{"json":{"format":"${ENCODED_QUERY_FORMAT}","mutations":[],"queries":[`;
  const suffix = "]}}";
  const encoder = new TextEncoder();
  let bytes = encoder.encode(prefix + suffix).byteLength;
  if (!Number.isSafeInteger(budget) || budget < bytes)
    throw new RangeError("Device query budget cannot hold the cache envelope");
  const entries: string[] = [];
  for (const query of state.queries) {
    // A failed refresh must not replace approved offline data with a transport
    // error, nor persist a server error payload alongside that private data.
    const entry = query.state.status === "error" ? {...query, state: {...query.state,
      status: "success" as const, error: null, fetchFailureCount: 0, fetchFailureReason: null, fetchStatus: "idle" as const,
    }} : query;
    const encoded = SuperJSON.stringify(entry);
    const size = encoder.encode(encoded).byteLength + (entries.length ? 1 : 0);
    if (bytes + size <= budget) { entries.push(encoded); bytes += size; }
  }
  return prefix + entries.join(",") + suffix;
}
export function decodeDeviceQueries(payload: string): DehydratedState {
  const encoded = SuperJSON.parse<EncodedQueries>(payload);
  if (encoded.format !== ENCODED_QUERY_FORMAT || !Array.isArray(encoded.queries))
    throw new Error("Invalid saved query format");
  return {
    mutations: [],
    queries: encoded.queries.map(query => SuperJSON.deserialize<DehydratedState["queries"][number]>(query)),
  };
}

interface Saved {
  generation?: string;
  account: string;
  version: number;
  payload: string;
}
export interface DeviceQueryStorage {
  read(): Promise<Saved | undefined>;
  write(value: Saved): Promise<void>;
  clear(advanceGeneration?: boolean): Promise<void>;
  discard?(value: Saved): Promise<void>;
  generation?(): Promise<string>;
  revoke?(account: string, generation: string): Promise<void>;
}
async function openStorage() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Device query storage request failed", {cause: request.error}));
    request.onblocked = () => reject(new Error("Device query storage blocked"));
  });
}
export const deviceQueryStorage: DeviceQueryStorage = {
  async generation() {
    const db = await openStorage();
    try { return await new Promise<string>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get("generation");
      request.onsuccess = () => resolve((request.result as string | undefined) ?? "");
      request.onerror = () => reject(new Error("Device query generation unavailable"));
    }); } finally { db.close(); }
  },
  async read() {
    const db = await openStorage();
    try { return await new Promise<Saved | undefined>((resolve, reject) => {
      const store = db.transaction(STORE).objectStore(STORE);
      const epoch = store.get("generation");
      const current = store.get("current");
      current.onsuccess = () => {
        const value = current.result as Saved | undefined;
        resolve(value && (value.generation ?? "") === (epoch.result ?? "") ? value : undefined);
      };
      current.onerror = () => reject(new Error("Device query storage request failed"));
    }); } finally { db.close(); }
  },
  async write(value) { await changeStorage(value); },
  async clear(advanceGeneration = true) { await changeStorage(undefined, undefined, advanceGeneration); },
  async revoke(account, generation) { await changeStorage(undefined, {account, generation}); },
  async discard(value) { await changeStorage(undefined, {account: value.account, generation: value.generation ?? "", payload: value.payload}, false); },
};
async function changeStorage(value?: Saved, revoke?: {account: string; generation: string; payload?: string}, advanceGeneration = true) {
  const db = await openStorage();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const epoch = store.get("generation");
    epoch.onsuccess = () => {
      const generation = (epoch.result as string | undefined) ?? "";
      if (value) {
        if ((value.generation ?? "") === generation) store.put(value, "current");
      } else if (!revoke || revoke.generation === generation) {
        const current = store.get("current");
        current.onsuccess = () => {
          if (revoke && current.result && (current.result as Saved).account !== revoke.account) return;
          if (revoke?.payload !== undefined && (current.result as Saved | undefined)?.payload !== revoke.payload) return;
          store.delete("current");
          if (advanceGeneration) store.put(crypto.randomUUID(), "generation");
        };
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error("Device query storage transaction failed", {cause: tx.error}));
  }); } finally { db.close(); }
}
// One serialized chain ensures a delayed write cannot resurrect data after wipe.
let storageWork = Promise.resolve();
function enqueue(work: () => Promise<void>) {
  storageWork = storageWork
    .catch(() => undefined)
    .then(work)
    .catch(() => undefined);
  return storageWork;
}
const clientAccounts = new WeakMap<QueryClient, string>();
const knownClients = new Set<QueryClient>();
export function clearAccountQueryMemory(client: QueryClient) {
  // Cancel before clearing so an old in-flight response cannot repopulate data.
  const cancelled = client.cancelQueries();
  client.clear();
  return cancelled.catch(() => undefined);
}
const activeCaches = new Set<{ client: QueryClient; stop(wipe?: boolean): Promise<void> }>();
export async function wipeDeviceQueryCaches() {
  for (const client of knownClients) { void clearAccountQueryMemory(client); clientAccounts.delete(client); }
  await Promise.all(Array.from(activeCaches, (cache) => cache.stop(true)));
  await enqueue(() => deviceQueryStorage.clear());
}
export function startDeviceQueryCache(
  client: QueryClient,
  account: string,
  storage = deviceQueryStorage,
) {
  const authority = {};
  currentReadAuthority = authority;
  const previouslyUsed = knownClients.has(client);
  knownClients.add(client);
  if (previouslyUsed && clientAccounts.get(client) !== account) {
    for (const old of activeCaches) if (old.client === client) void old.stop(true);
    void clearAccountQueryMemory(client);
  }
  clientAccounts.set(client, account);
  let stopped = false;
  let restored = false;
  let generation = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    if (stopped || !restored) return storageWork;
    return enqueue(async () => {
      if (!stopped)
        await storage.write({
          account,
          generation,
          version: DEVICE_QUERY_VERSION,
          payload: encodeDeviceQueries(client),
        });
    });
  };
  const ready = enqueue(async () => {
    generation = await storage.generation?.() ?? "";
    const saved = await storage.read();
    if (stopped) return;
    // A separate tab may have revoked and rebound between these two reads.
    // Never hydrate its newer generation into this already-started session.
    if (saved && (saved.generation ?? "") !== generation) { void session.stop(); return; }
    if (
      saved?.account === account &&
      saved.version === DEVICE_QUERY_VERSION &&
      new TextEncoder().encode(saved.payload).byteLength <= DEVICE_QUERY_BUDGET
    ) {
      try {
        const state = decodeDeviceQueries(saved.payload);
        if (!Array.isArray(state.queries))
          throw new Error("Invalid saved queries");
        // Check the allowlist again on restore after any policy changes.
        state.queries = state.queries.filter((q) =>
          shouldPersistDeviceQuery({ ...q, meta: q.meta } as Query),
        );
        state.mutations = [];
        hydrate(client, state);
      } catch {
        if (storage.discard) await storage.discard(saved); else await storage.clear(false);
      }
    } else if (saved) if (storage.discard) await storage.discard(saved); else await storage.clear(false);
    restored = true;
  });
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.type === "updated" && client.getQueryCache().get(event.query.queryHash) !== event.query) return;
    if (event.type === "updated" && event.action.type === "error" && reviewedAuthorityRead(event.query) && isDeviceReadDenial(event.action.error)) {
      reportDeviceReadDenial(((event.query as Pick<Query, "queryKey">).queryKey[0] as string[]).join("."), "query", event.action.error, authority);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => { void save(); }, 300);
  });
  const session = {
    client,
    ready,
    flush: save,
    stop(wipe = false) {
      if (currentReadAuthority === authority) currentReadAuthority = null;
      stopped = true;
      activeCaches.delete(session);
      unsubscribe();
      clearTimeout(timer);
      if (wipe) {
        if (clientAccounts.get(client) === account) {
          void clearAccountQueryMemory(client);
          clientAccounts.delete(client);
        }
        return enqueue(async () => {
          // An old effect cleanup must not erase a newer account's record.
          if (storage.revoke) await storage.revoke(account, generation);
          else if ((await storage.read())?.account === account) await storage.clear();
        });
      }
      return storageWork;
    },
  };
  activeCaches.add(session);
  return session;
}
