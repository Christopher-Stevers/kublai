import {
  dehydrate,
  hydrate,
  type Query,
  type QueryClient,
  type DehydratedState,
} from "@tanstack/react-query";
import SuperJSON from "superjson";
import { isInstantQueryPending } from "./instant-query-update";

export const DEVICE_QUERY_VERSION = 1;
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
export function shouldPersistDeviceQuery(
  query: Pick<Query, "queryKey" | "state" | "meta">,
) {
  const path = query.queryKey[0];
  return (
    !isInstantQueryPending(query) &&
    query.meta?.persist !== false &&
    query.state.status === "success" &&
    Array.isArray(path) &&
    READS.has(path.join("."))
  );
}
export function encodeDeviceQueries(
  client: QueryClient,
  budget = DEVICE_QUERY_BUDGET,
) {
  const state = dehydrate(client, {
    shouldDehydrateQuery: shouldPersistDeviceQuery,
    shouldDehydrateMutation: () => false,
  });
  state.queries.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  const retained: DehydratedState = { mutations: [], queries: [] };
  for (const query of state.queries) {
    const candidate = { ...retained, queries: [...retained.queries, query] };
    if (
      new TextEncoder().encode(SuperJSON.stringify(candidate)).byteLength <=
      budget
    )
      retained.queries.push(query);
  }
  return SuperJSON.stringify(retained);
}
interface Saved {
  account: string;
  version: number;
  payload: string;
}
export interface DeviceQueryStorage {
  read(): Promise<Saved | undefined>;
  write(value: Saved): Promise<void>;
  clear(): Promise<void>;
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
  async read() {
    const db = await openStorage();
    try {
      return await new Promise<Saved | undefined>((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).get("current");
        request.onsuccess = () => resolve(request.result as Saved | undefined);
        request.onerror = () => reject(new Error("Device query storage request failed", {cause: request.error}));
      });
    } finally {
      db.close();
    }
  },
  async write(value) {
    await changeStorage(value);
  },
  async clear() {
    await changeStorage();
  },
};
async function changeStorage(value?: Saved) {
  const db = await openStorage();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      if (value) tx.objectStore(STORE).put(value, "current");
      else tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error("Device query storage transaction failed", {cause: tx.error}));
    });
  } finally {
    db.close();
  }
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
  const previouslyUsed = knownClients.has(client);
  knownClients.add(client);
  if (previouslyUsed && clientAccounts.get(client) !== account) {
    for (const old of activeCaches) if (old.client === client) void old.stop(true);
    void clearAccountQueryMemory(client);
  }
  clientAccounts.set(client, account);
  let stopped = false;
  let restored = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    if (stopped || !restored) return;
    void enqueue(async () => {
      if (!stopped)
        await storage.write({
          account,
          version: DEVICE_QUERY_VERSION,
          payload: encodeDeviceQueries(client),
        });
    });
  };
  const ready = enqueue(async () => {
    const saved = await storage.read();
    if (stopped) return;
    if (
      saved?.account === account &&
      saved.version === DEVICE_QUERY_VERSION &&
      new TextEncoder().encode(saved.payload).byteLength <= DEVICE_QUERY_BUDGET
    ) {
      try {
        const state = SuperJSON.parse<DehydratedState>(saved.payload);
        if (!Array.isArray(state.queries))
          throw new Error("Invalid saved queries");
        // Check the allowlist again on restore after any policy changes.
        state.queries = state.queries.filter((q) =>
          shouldPersistDeviceQuery({ ...q, meta: q.meta } as Query),
        );
        state.mutations = [];
        hydrate(client, state);
      } catch {
        await storage.clear();
      }
    } else if (saved) await storage.clear();
    restored = true;
  });
  const unsubscribe = client.getQueryCache().subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(save, 300);
  });
  const session = {
    client,
    ready,
    flush: save,
    stop(wipe = false) {
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
          if ((await storage.read())?.account === account) await storage.clear();
        });
      }
      return storageWork;
    },
  };
  activeCaches.add(session);
  return session;
}
