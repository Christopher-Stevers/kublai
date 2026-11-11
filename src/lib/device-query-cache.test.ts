import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import SuperJSON from "superjson";
import {
  encodeDeviceQueries,
  startDeviceQueryCache,
  DEVICE_QUERY_VERSION,
  type DeviceQueryStorage,
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
      (SuperJSON.parse(payload) as { mutations: unknown[] }).mutations,
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
    session.flush();
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
      write: async () => {},
      clear: async () => {},
    });
    await session.ready;
    expect(client.getQueryData(key)).toBe("online");
    await session.stop();
  });
});
