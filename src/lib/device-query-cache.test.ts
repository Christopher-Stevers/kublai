import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";
import { describe, it, expect } from "vitest";
import { beginInstantQueryUpdate } from "./instant-query-update";
import { QueryClient } from "@tanstack/react-query";
import SuperJSON from "superjson";
import {
  encodeDeviceQueries,
  deviceQueryStorage,
  reportDeviceReadDenial,
  captureDeviceReadAuthority,
  denialRevokesDrawings,
  decodeDeviceQueries,
  DEVICE_QUERY_DENIED_EVENT,
  startDeviceQueryCache,
  DEVICE_QUERY_VERSION,
  type DeviceQueryStorage,
  shouldPersistDeviceQuery,
} from "./device-query-cache";
function storage() {
  let value: Awaited<ReturnType<DeviceQueryStorage["read"]>>;
  const device: DeviceQueryStorage = {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
    clear: async () => {
      value = undefined;
    },
  };
  return device;
}
const key = [["job", "getJob"], { input: { id: "one" }, type: "query" }];
describe("device query cache", () => {
  it("round trips dates only after a matching authenticated account starts", async () => {
    const source = new QueryClient();
    source.setQueryData(key, { date: new Date("2026-01-01"), name: "Job" });
    const device = storage();
    await device.write({
      account: "org:a",
      version: DEVICE_QUERY_VERSION,
      payload: encodeDeviceQueries(source),
    });
    const target = new QueryClient();
    expect(target.getQueryData(key)).toBeUndefined();
    const session = startDeviceQueryCache(target, "org:a", device);
    await session.ready;
    expect(target.getQueryData(key)).toEqual(source.getQueryData(key));
    await session.stop();
  });
  it("excludes unknown/sensitive reads and all mutations and respects the byte budget", () => {
    const client = new QueryClient();
    client.setQueryData(key, { name: "x".repeat(1000) });
    client.setQueryData([["payments", "list"]], { secret: "card" });
    client.setQueryDefaults([["assets", "overview"]], {
      meta: { persist: false },
    });
    client.setQueryData([["assets", "overview"]], { private: true });
    const payload = encodeDeviceQueries(client);
    expect(payload).not.toContain("card");
    expect(payload).not.toContain("private");
    expect(
      SuperJSON.parse<{ mutations: unknown[] }>(payload).mutations,
    ).toEqual([]);
    expect(
      new TextEncoder().encode(encodeDeviceQueries(client, 200)).byteLength,
    ).toBeLessThanOrEqual(200);
  });
  it("wipes on account and data version change without restoring another account", async () => {
    for (const saved of [
      { account: "org:b", version: DEVICE_QUERY_VERSION },
      { account: "org:a", version: 0 },
    ]) {
      const device = storage(),
        client = new QueryClient();
      const source = new QueryClient();
      source.setQueryData(key, { private: true });
      await device.write({ ...saved, payload: encodeDeviceQueries(source) });
      const session = startDeviceQueryCache(client, "org:a", device);
      await session.ready;
      expect(client.getQueryData(key)).toBeUndefined();
      expect(await device.read()).toBeUndefined();
      await session.stop();
    }
  });
  it("logout clears memory and waits for pending writes before wiping", async () => {
    const device = storage(),
      client = new QueryClient();
    client.setQueryData(key, { private: true });
    const session = startDeviceQueryCache(client, "org:a", device);
    await session.ready;
    void session.flush();
    await session.stop(true);
    expect(client.getQueryData(key)).toBeUndefined();
    expect(await device.read()).toBeUndefined();
  });
  it("storage refusal leaves live network query data available", async () => {
    const client = new QueryClient();
    client.setQueryData(key, "online");
    const session = startDeviceQueryCache(client, "org:a", {
      read: async () => {
        throw Error("denied");
      },
      write: async () => undefined,
      clear: async () => undefined,
    });
    await session.ready;
    expect(client.getQueryData(key)).toBe("online");
    await session.stop();
  });
});

it("account transition cancels pending reads and clears sensitive success/error data", async () => {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const first = startDeviceQueryCache(client, "org:a", storage());
  await first.ready;
  client.setQueryData([["payments", "list"]], { private: "old account" });
  client.setQueryData([["chat", "list"]], { private: "old error data" });
  client.getQueryCache().find({queryKey: [["chat", "list"]]})!.setState({status: "error"});
  let aborted = false;
  const pending = client.fetchQuery({queryKey: [["permissions", "list"]], queryFn: ({signal}) => new Promise(resolve => {
    signal.addEventListener("abort", () => { aborted = true; resolve("late old response"); });
  })}).catch(() => undefined);
  const second = startDeviceQueryCache(client, "org:b", storage());
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  await pending;
  await second.ready;
  expect(aborted).toBe(true);
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  await second.stop(true);
});

it("a new login also drops data written after a previous session was stopped", async () => {
  const client = new QueryClient();
  const first = startDeviceQueryCache(client, "org:a", storage());
  await first.ready;
  await first.stop(true);
  client.setQueryData([["private", "late"]], "old completion");
  const second = startDeviceQueryCache(client, "org:b", storage());
  await second.ready;
  expect(client.getQueryData([["private", "late"]])).toBeUndefined();
  await second.stop(true);
});

it("never persists an unacknowledged optimistic allowed read; finish permits accepted/rolled-back data", () => {
  for (const rollback of [false, true]) {
    const client = new QueryClient();
    client.setQueryData(key, {name: "acknowledged"});
    const edit = beginInstantQueryUpdate<{name: string}>(client, key, () => ({name: "optimistic"}));
    expect(SuperJSON.parse<{queries: unknown[]}>(encodeDeviceQueries(client)).queries).toHaveLength(0);
    if (rollback) edit.rollback();
    expect(SuperJSON.parse<{queries: unknown[]}>(encodeDeviceQueries(client)).queries).toHaveLength(0);
    edit.finish?.();
    const encoded = encodeDeviceQueries(client);
    expect(SuperJSON.parse<{queries: unknown[]}>(encoded).queries).toHaveLength(1);
    expect(encoded).toContain(rollback ? "acknowledged" : "optimistic");
  }
});

it("budgets UTF-8 bytes exactly, prefers newer reads, and skips oversized records", () => {
  const client = new QueryClient();
  const queryKey = (id: string) => [["job", "getJob"], {input: {id}, type: "query"}];
  client.setQueryData(queryKey("old"), {name: "old", value: "x".repeat(20000)}, {updatedAt: 10});
  client.setQueryData(queryKey("middle"), {name: "middle", value: "雪".repeat(30)}, {updatedAt: 20});
  client.setQueryData(queryKey("new"), {name: "new", when: new Date("2026-01-01")}, {updatedAt: 30});
  const payload = encodeDeviceQueries(client, 1800);
  expect(new TextEncoder().encode(payload).byteLength).toBeLessThanOrEqual(1800);
  const restored = decodeDeviceQueries(payload);
  expect(restored.queries.map(query => (query.state.data as {name: string}).name)).toEqual(["new", "middle"]);
  expect((restored.queries[0]!.state.data as {when: Date}).when).toBeInstanceOf(Date);
  expect(() => encodeDeviceQueries(client, 1)).toThrow(RangeError);
});

for (const code of ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"]) it(`clears previously cached reads after ${code}, including saved storage`, async () => {
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  client.setQueryData(key, {private: "previously acknowledged"});
  const device = storage();
  await device.write({account:"org:a",version:DEVICE_QUERY_VERSION,payload:encodeDeviceQueries(client)});
  const session = startDeviceQueryCache(client,"org:a",device); await session.ready;
  const denied = vi.fn();window.addEventListener(DEVICE_QUERY_DENIED_EVENT,denied);
  await client.fetchQuery({queryKey:key,staleTime:0,retry:false,queryFn:async()=>{throw Object.assign(new Error("Read denied"),{data:{code}});}}).catch(()=>undefined);
  await session.stop();
  expect(client.getQueryData(key)).toBeUndefined();
  expect(await device.read()).toBeUndefined();
  expect(denied).toHaveBeenCalledOnce();window.removeEventListener(DEVICE_QUERY_DENIED_EVENT,denied);
});
it("keeps acknowledged current/saved data after offline errors and ignores refused mutations", async () => {
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  client.setQueryData(key,{private:"acknowledged",date:new Date("2026-01-01")});
  const device=storage();const session=startDeviceQueryCache(client,"org:a",device);await session.ready;
  const denied=vi.fn();window.addEventListener(DEVICE_QUERY_DENIED_EVENT,denied);
  await client.fetchQuery({queryKey:key,staleTime:0,retry:false,queryFn:async()=>{throw new TypeError("Network offline");}}).catch(()=>undefined);
  await session.flush();
  expect(client.getQueryData(key)).toEqual({private:"acknowledged",date:new Date("2026-01-01")});
  const saved=await device.read();expect(saved).toBeDefined();
  expect(decodeDeviceQueries(saved!.payload).queries[0]!.state).toMatchObject({status:"success",error:null,data:{private:"acknowledged",date:new Date("2026-01-01")}});
  const mutation=client.getMutationCache().build(client,{mutationFn:async()=>{throw Object.assign(new Error("Mutation refused"),{data:{code:"FORBIDDEN"}});}});
  await mutation.execute(undefined).catch(()=>undefined);
  expect(denied).not.toHaveBeenCalled();
  expect(client.getQueryData(key)).toBeDefined();window.removeEventListener(DEVICE_QUERY_DENIED_EVENT,denied);
  await session.stop();
});

it("round trips dates with the production client's nested SuperJSON hydrate options", async () => {
  const make = () => new QueryClient({defaultOptions:{dehydrate:{serializeData:SuperJSON.serialize},hydrate:{deserializeData:SuperJSON.deserialize}}});
  const source = make();source.setQueryData(key,{date:new Date("2026-01-01")});
  const device = storage();await device.write({account:"org:a",version:DEVICE_QUERY_VERSION,payload:encodeDeviceQueries(source)});
  const target = make();const session = startDeviceQueryCache(target,"org:a",device);await session.ready;
  expect(target.getQueryData(key)).toEqual({date:new Date("2026-01-01")});
  await session.stop(true);
});

it("a delayed pending save cannot resurrect a read after access denial", async () => {
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  client.setQueryData(key,{private:"approved before revocation"});
  let value: Awaited<ReturnType<DeviceQueryStorage["read"]>>;
  let finishWrite: () => void = () => undefined;
  let started: () => void = () => undefined;
  const writing = new Promise<void>(resolve=>{started=resolve;});
  const device: DeviceQueryStorage = {
    read:async()=>value,
    write:async next=>{started();await new Promise<void>(resolve=>{finishWrite=resolve;});value=next;},
    clear:async()=>{value=undefined;},
  };
  const session = startDeviceQueryCache(client,"org:a",device);await session.ready;
  void session.flush();await writing;
  await client.fetchQuery({queryKey:key,staleTime:0,retry:false,queryFn:async()=>{throw Object.assign(new Error("No longer visible"),{data:{code:"FORBIDDEN"}});}}).catch(()=>undefined);
  expect(client.getQueryData(key)).toBeUndefined();
  finishWrite();await session.stop();
  expect(await device.read()).toBeUndefined();
});

it("does not delete unrelated drawings for a deleted asset, but does for denied drawing access", () => {
  expect(denialRevokesDrawings({queryKey: [["assets", "getAsset"]]}, {data: {code: "NOT_FOUND"}})).toBe(false);
  expect(denialRevokesDrawings({queryKey: [["assets", "getAsset"]]}, {data: {httpStatus: 403}})).toBe(true);
  expect(denialRevokesDrawings({queryKey: [["drawingsWorkspace", "get"]]}, {data: {code: "NOT_FOUND"}})).toBe(true);
});

it("atomically rejects stale-tab saved writes and stale revocation after a fresh session", async () => {
  const previous = globalThis.indexedDB;
  vi.stubGlobal("indexedDB", new IDBFactory());
  try {
    const oldGeneration = await deviceQueryStorage.generation!();
    const old = {account: "org:a", version: DEVICE_QUERY_VERSION, generation: oldGeneration, payload: "old"};
    await deviceQueryStorage.write(old);
    await deviceQueryStorage.revoke!("org:a", oldGeneration);
    await deviceQueryStorage.write(old);
    expect(await deviceQueryStorage.read()).toBeUndefined();
    const generation = await deviceQueryStorage.generation!();
    await deviceQueryStorage.write({...old, generation, payload: "fresh"});
    await deviceQueryStorage.revoke!("org:a", oldGeneration);
    await deviceQueryStorage.discard!(old);
    expect((await deviceQueryStorage.read())?.payload).toBe("fresh");
  } finally { vi.stubGlobal("indexedDB", previous); }
});
it("reports raw reviewed workspace query denials, without treating network or mutation failures as revocation", () => {
  const denied = vi.fn(); window.addEventListener(DEVICE_QUERY_DENIED_EVENT, denied);
  expect(reportDeviceReadDenial("drawingsWorkspace.get", "query", {data: {code: "FORBIDDEN"}})).toBe(true);
  expect(reportDeviceReadDenial("drawingsWorkspace.get", "query", new TypeError("Failed to fetch"))).toBe(false);
  expect(reportDeviceReadDenial("drawingsWorkspace.save", "mutation", {data: {code: "FORBIDDEN"}})).toBe(false);
  expect(denied).toHaveBeenCalledOnce();
  window.removeEventListener(DEVICE_QUERY_DENIED_EVENT, denied);
});

it("ignores an old raw-read denial after a newer account binds", async () => {
  const old = startDeviceQueryCache(new QueryClient(), "org:old", storage()); await old.ready;
  const authority = captureDeviceReadAuthority();
  await old.stop();
  const fresh = startDeviceQueryCache(new QueryClient(), "org:new", storage()); await fresh.ready;
  expect(reportDeviceReadDenial("drawingsWorkspace.get", "query", {data: {code: "FORBIDDEN"}}, authority)).toBe(false);
  await fresh.stop();
});

it("does not hydrate or discard a fresh generation observed after an older restore starts", async () => {
  const source = new QueryClient(); source.setQueryData(key, {private: "fresh binding"});
  const device = storage();
  await device.write({account: "org:a", generation: "new", version: DEVICE_QUERY_VERSION, payload: encodeDeviceQueries(source)});
  device.generation = async () => "old";
  const client = new QueryClient(); const session = startDeviceQueryCache(client, "org:a", device);
  await session.ready;
  expect(client.getQueryData(key)).toBeUndefined();
  expect((await device.read())?.generation).toBe("new");
  await session.stop();
});

it("treats a selected-floor denial as authority without persisting floor detail", async () => {
  const client = new QueryClient(), device = storage();
  const session = startDeviceQueryCache(client, "org:rooms", device); await session.ready;
  const key = [["rooms", "getFloorRooms"], { input: { jobId: "job", floorId: "floor" }, type: "query" }];
  client.setQueryData(key, { id: "floor", rooms: [{ id: "private-room" }] });
  expect(decodeDeviceQueries(encodeDeviceQueries(client)).queries).toHaveLength(0);
  const denied = vi.fn(); window.addEventListener(DEVICE_QUERY_DENIED_EVENT, denied);
  try {
    await client.fetchQuery({ queryKey: key, staleTime: 0, retry: false, queryFn: async () => { throw Object.assign(new Error("No access"), { data: { code: "FORBIDDEN" } }); } }).catch(() => undefined);
    expect(denied).toHaveBeenCalledOnce(); expect(client.getQueryData(key)).toBeUndefined();
  } finally { window.removeEventListener(DEVICE_QUERY_DENIED_EVENT, denied); await session.stop(); client.clear(); }
});

const chatJob = "11111111-1111-4111-8111-111111111111";
const latestChatKey = [
  ["chat", "history"],
  { input: { jobId: chatJob, limit: 50 }, type: "query" },
];
it("persists only an opened job's exact latest50 history key, excluding chat authority, other conversations and cursor variants", () => {
  const client = new QueryClient();
  const put = (key: unknown[], visited = true) => {
    client.setQueryDefaults(key, { meta: { deviceJobChatHistory: visited } });
    client.setQueryData(key, { private: "server-acknowledged rows" });
  };
  put(latestChatKey);
  put([
    ["chat", "history"],
    { input: { jobId: chatJob, limit: 50, beforeSequence: 10 }, type: "query" },
  ]);
  put([
    ["chat", "history"],
    { input: { jobId: chatJob, limit: 100 }, type: "query" },
  ]);
  put([
    ["chat", "history"],
    { input: { jobId: "not-a-job-id", limit: 50 }, type: "query" },
  ]);
  put([
    ["chat", "history"],
    { input: { jobId: chatJob, limit: 50 }, type: "infinite" },
  ]);
  put(
    [
      ["chat", "history"],
      {
        input: { jobId: "22222222-2222-4222-8222-222222222222", limit: 50 },
        type: "query",
      },
    ],
    false,
  );
  for (const path of [
    ["chat", "getOverview"],
    ["chat", "members"],
    ["conversations", "history"],
    ["conversations", "list"],
  ])
    put([path, { input: { jobId: chatJob, limit: 50 }, type: "query" }]);
  expect(
    decodeDeviceQueries(encodeDeviceQueries(client)).queries.map(
      (query) => query.queryKey,
    ),
  ).toEqual([latestChatKey]);
  const query = client
    .getQueryCache()
    .find({ queryKey: latestChatKey, exact: true })!;
  const pending = beginInstantQueryUpdate(client, latestChatKey, () => ({
    private: "unconfirmed optimistic rows",
  }));
  expect(shouldPersistDeviceQuery(query)).toBe(false);
  pending.rollback();
  pending.finish?.();
  expect(shouldPersistDeviceQuery(query)).toBe(true);
  client.clear();
});

it("reports raw job-chat authority denials for imperative reads but ignores transient errors, writes and old accounts", async () => {
  const device = storage(),
    client = new QueryClient();
  const first = startDeviceQueryCache(client, "org:chat", device);
  await first.ready;
  const authority = captureDeviceReadAuthority();
  const denied = vi.fn();
  window.addEventListener(DEVICE_QUERY_DENIED_EVENT, denied);
  try {
    expect(
      reportDeviceReadDenial(
        "chat.history",
        "query",
        new Error("Gateway timeout"),
        authority,
      ),
    ).toBe(false);
    expect(
      reportDeviceReadDenial(
        "chat.send",
        "mutation",
        { data: { code: "FORBIDDEN" } },
        authority,
      ),
    ).toBe(false);
    expect(
      reportDeviceReadDenial(
        "chat.history",
        "query",
        { data: { httpStatus: 410 } },
        authority,
      ),
    ).toBe(true);
    await first.stop();
    const second = startDeviceQueryCache(client, "org:new", device);
    await second.ready;
    expect(
      reportDeviceReadDenial(
        "chat.getOverview",
        "query",
        { data: { code: "UNAUTHORIZED" } },
        authority,
      ),
    ).toBe(false);
    expect(
      reportDeviceReadDenial("chat.members", "query", {
        data: { code: "FORBIDDEN" },
      }),
    ).toBe(true);
    await second.stop();
    expect(denied).toHaveBeenCalledTimes(2);
  } finally {
    window.removeEventListener(DEVICE_QUERY_DENIED_EVENT, denied);
    await first.stop();
    client.clear();
  }
});

it("treats only the exact document materialization mutation as a read denial and fences old request authority", async () => {
  const old = startDeviceQueryCache(new QueryClient(), "org:old-materializer", storage()); await old.ready;
  const captured = captureDeviceReadAuthority(); await old.stop();
  const fresh = startDeviceQueryCache(new QueryClient(), "org:new-materializer", storage()); await fresh.ready;
  const denied = vi.fn(); window.addEventListener(DEVICE_QUERY_DENIED_EVENT, denied);
  try {
    const error = {data: {code: "FORBIDDEN"}};
    expect(reportDeviceReadDenial("drawingsWorkspace.openDocument", "mutation", error, captured)).toBe(false);
    expect(reportDeviceReadDenial("drawingsWorkspace.save", "mutation", error, captureDeviceReadAuthority())).toBe(false);
    expect(reportDeviceReadDenial("drawingsWorkspace.openDocumentOther", "mutation", error, captureDeviceReadAuthority())).toBe(false);
    expect(reportDeviceReadDenial("drawingsWorkspace.openDocument", "mutation", new Error("Network failed"), captureDeviceReadAuthority())).toBe(false);
    expect(denied).not.toHaveBeenCalled();
    expect(reportDeviceReadDenial("drawingsWorkspace.openDocument", "mutation", error, captureDeviceReadAuthority())).toBe(true);
    expect(denied).toHaveBeenCalledOnce();
  } finally {window.removeEventListener(DEVICE_QUERY_DENIED_EVENT, denied); await fresh.stop();}
});

it("scopes missing orders away from global revocation while retaining identity denial and no persistence", async () => {
  const session = startDeviceQueryCache(new QueryClient(), "org:order-reader", storage()); await session.ready;
  const authority = captureDeviceReadAuthority();
  const denied = vi.fn(); window.addEventListener(DEVICE_QUERY_DENIED_EVENT, denied);
  try {
    expect(reportDeviceReadDenial("materialList.getOrderById", "query", { data: { code: "NOT_FOUND" } }, authority)).toBe(false);
    expect(reportDeviceReadDenial("materialList.getOrderById", "query", { data: { httpStatus: 410 } }, authority)).toBe(false);
    expect(denied).not.toHaveBeenCalled();
    expect(captureDeviceReadAuthority()).toBe(authority);
    expect(shouldPersistDeviceQuery({ queryKey: [["materialList", "getOrderById"], { input: { orderId: "order" }, type: "query" }], state: { status: "success", data: { canReceive: true } }, meta: {} } as never)).toBe(false);
    expect(reportDeviceReadDenial("materialList.getOrderById", "mutation", { data: { code: "FORBIDDEN" } }, authority)).toBe(false);
    expect(reportDeviceReadDenial("materialList.getOrderById", "query", { data: { code: "FORBIDDEN" } }, authority)).toBe(true);
    expect(denied).toHaveBeenCalledOnce();
  } finally { window.removeEventListener(DEVICE_QUERY_DENIED_EVENT, denied); await session.stop(); }
});
