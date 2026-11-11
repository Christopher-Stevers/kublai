import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  decodeDeviceQueries,
  startDeviceQueryCache,
  type DeviceQueryStorage,
} from "./device-query-cache";
import { beginInstantQueryUpdate } from "./instant-query-update";

const key = [["job", "getJob"], { input: { id: "one" }, type: "query" }];
const sessions: ReturnType<typeof startDeviceQueryCache>[] = [];
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.stop()));
  clients.splice(0).forEach(client => client.clear());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  clients.push(client);
  let saved: Awaited<ReturnType<DeviceQueryStorage["read"]>>;
  const device = {
    read: async () => saved,
    write: vi.fn(async (value: Parameters<DeviceQueryStorage["write"]>[0]) => { saved = value; }),
    clear: vi.fn(async () => { saved = undefined; }),
  } satisfies DeviceQueryStorage;
  const session = startDeviceQueryCache(client, "org:a", device);
  sessions.push(session);
  await session.ready;
  return { client, device, session, entries: () => saved ? decodeDeviceQueries(saved.payload).queries : [] };
}

it("coalesces a real observer mount/options storm into one native save timer", async () => {
  const { client, device, entries } = await setup();
  const timeout = vi.spyOn(globalThis, "setTimeout");
  const cancel = vi.spyOn(globalThis, "clearTimeout");
  const events: string[] = [];
  const unwatch = client.getQueryCache().subscribe(event => events.push(event.type));
  client.setQueryData(key, { name: "saved job" });
  const observers = Array.from({ length: 25 }, (_, id) => {
    const options = { queryKey: [["supplier", "list"], { id }], enabled: false };
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => undefined);
    observer.setOptions({ ...options, meta: { persist: false } });
    return unsubscribe;
  });
  observers.forEach(unsubscribe => unsubscribe());
  unwatch();
  expect(events.length).toBeGreaterThan(100);
  expect(timeout.mock.calls.filter(([, delay]) => delay === 300)).toHaveLength(1);
  expect(cancel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(299);
  expect(device.write).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(device.write).toHaveBeenCalledOnce();
  expect(entries().map(query => query.state.data)).toEqual([{ name: "saved job" }]);
});

it("retains the full trailing quiet period and schedules again after a completed save", async () => {
  const { client, device, entries } = await setup();
  client.setQueryData(key, "first");
  await vi.advanceTimersByTimeAsync(250);
  client.setQueryData(key, "second");
  await vi.advanceTimersByTimeAsync(250);
  client.setQueryData(key, "latest");
  await vi.advanceTimersByTimeAsync(299);
  expect(device.write).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(device.write).toHaveBeenCalledOnce();
  expect(entries()[0]?.state.data).toBe("latest");
  client.setQueryData(key, "after save");
  await vi.advanceTimersByTimeAsync(300);
  expect(device.write).toHaveBeenCalledTimes(2);
  expect(entries()[0]?.state.data).toBe("after save");
});

it("saves metadata-only opt-outs and visited-history opt-ins without a data update", async () => {
  const { client, entries } = await setup();
  const historyKey = [["chat", "history"], {
    type: "query", input: { jobId: "11111111-1111-4111-8111-111111111111", limit: 50 },
  }];
  client.setQueryData(key, "job");
  client.setQueryData(historyKey, "acknowledged history");
  const job = new QueryObserver(client, { queryKey: key, enabled: false });
  const history = new QueryObserver(client, { queryKey: historyKey, enabled: false });
  await vi.advanceTimersByTimeAsync(300);
  expect(entries().map(query => query.state.data)).toEqual(["job"]);
  const updatedAt = client.getQueryState(historyKey)?.dataUpdatedAt;
  job.setOptions({ queryKey: key, enabled: false, meta: { persist: false } });
  history.setOptions({ queryKey: historyKey, enabled: false, meta: { deviceJobChatHistory: true } });
  await vi.advanceTimersByTimeAsync(300);
  expect(client.getQueryState(historyKey)?.dataUpdatedAt).toBe(updatedAt);
  expect(entries().map(query => query.state.data)).toEqual(["acknowledged history"]);
  job.setOptions({ queryKey: key, enabled: false, meta: { persist: true } });
  history.setOptions({ queryKey: historyKey, enabled: false, meta: { deviceJobChatHistory: false } });
  await vi.advanceTimersByTimeAsync(300);
  expect(entries().map(query => query.state.data)).toEqual(["job"]);
});

it("persists manual state and removes reset or evicted records", async () => {
  const { client, entries } = await setup();
  client.setQueryData(key, "initial");
  const query = client.getQueryCache().find({ queryKey: key })!;
  query.setState({ data: "manual state", dataUpdatedAt: 1, status: "success" });
  await vi.advanceTimersByTimeAsync(300);
  expect(entries()[0]?.state.data).toBe("manual state");
  query.reset();
  await vi.advanceTimersByTimeAsync(300);
  expect(entries()).toEqual([]);
  client.setQueryData(key, "restored");
  await vi.advanceTimersByTimeAsync(300);
  expect(entries()[0]?.state.data).toBe("restored");
  client.removeQueries({ queryKey: key });
  await vi.advanceTimersByTimeAsync(300);
  expect(entries()).toEqual([]);
});

it("excludes a pending preview until its owner finishes", async () => {
  const { client, entries } = await setup();
  client.setQueryData(key, { name: "acknowledged" });
  const edit = beginInstantQueryUpdate(client, key, () => ({ name: "pending" }));
  await vi.advanceTimersByTimeAsync(300);
  expect(entries()).toEqual([]);
  edit.finish?.();
  await vi.advanceTimersByTimeAsync(300);
  expect(entries()[0]?.state.data).toEqual({ name: "pending" });
});

it("processes authority denial immediately while a save timer is pending", async () => {
  const { client, device, session } = await setup();
  client.setQueryData(key, "private");
  await session.flush();
  await client.fetchQuery({ queryKey: key, queryFn: async () => {
    throw Object.assign(new Error("Access revoked"), { data: { code: "FORBIDDEN" } });
  } }).catch(() => undefined);
  expect(client.getQueryData(key)).toBeUndefined();
  await session.stop();
  expect(await device.read()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1000);
  expect(device.write).toHaveBeenCalledOnce();
  expect(await device.read()).toBeUndefined();
});

it("cancels pending work on stop and account replacement", async () => {
  const { client, device, session } = await setup();
  client.setQueryData(key, "old account");
  const next = startDeviceQueryCache(client, "org:b", device);
  sessions.push(next);
  await next.ready;
  await vi.advanceTimersByTimeAsync(300);
  expect(await device.read()).toBeUndefined();
  client.setQueryData(key, "new account");
  await vi.advanceTimersByTimeAsync(300);
  expect((await device.read())?.account).toBe("org:b");
  client.setQueryData(key, "not flushed");
  await next.stop();
  await session.stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(decodeDeviceQueries((await device.read())!.payload).queries[0]?.state.data).toBe("new account");
});

it("encodes the latest eligible data when a save waits behind storage work", async () => {
  const { client, device, session, entries } = await setup();
  const originalWrite = device.write;
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { started = resolve; });
  let first = true;
  device.write = vi.fn(async (value: Parameters<DeviceQueryStorage["write"]>[0]) => {
    if (first) {
      first = false;
      started();
      await blocked;
    }
    await originalWrite(value);
  });
  client.setQueryData(key, "first");
  const firstWrite = session.flush();
  await writing;
  client.setQueryData(key, "queued");
  await vi.advanceTimersByTimeAsync(300);
  expect(device.write).toHaveBeenCalledOnce();
  client.setQueryData(key, "latest before queued write");
  release();
  await firstWrite;
  await vi.advanceTimersByTimeAsync(0);
  expect(device.write).toHaveBeenCalledTimes(2);
  expect(entries()[0]?.state.data).toBe("latest before queued write");
});
