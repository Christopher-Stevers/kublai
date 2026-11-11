import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { beginInstantQueryUpdate } from "./instant-query-update";

const key = ["order", "fixture"];
const setup = () => {
  const client = new QueryClient();
  client.setQueryData(key, { notes: "before", count: 2 });
  return client;
};
type Row = { notes: string; count: number };

describe("short-lived optimistic query edits", () => {
  it("updates immediately and restores a refused write", () => {
    const client = setup();
    const change = beginInstantQueryUpdate<Row>(client, key, old => ({ ...old, notes: "after" }));
    expect(client.getQueryData(key)).toEqual({ notes: "after", count: 2 });
    change.rollback();
    change.finish?.();
    expect(client.getQueryData(key)).toEqual({ notes: "before", count: 2 });
  });

  it("reconciles server normalization and releases the record", () => {
    const client = setup();
    const change = beginInstantQueryUpdate<Row, string>(client, key,
      old => ({ ...old, notes: "  after  " }), (result, old) => ({ ...old, notes: result }));
    change.commit?.("after");
    change.finish?.();
    expect(client.getQueryData(key)).toEqual({ notes: "after", count: 2 });
    expect(() => beginInstantQueryUpdate<Row>(client, key, old => old)).not.toThrow();
  });

  it("refuses a second overlapping edit instead of queuing or restoring failed edits", () => {
    const client = setup();
    const first = beginInstantQueryUpdate<Row>(client, key, old => ({ ...old, notes: "first" }));
    expect(() => beginInstantQueryUpdate<Row>(client, key, old => ({ ...old, notes: "second" }))).toThrow("still being saved");
    first.rollback();
    first.finish?.();
    const second = beginInstantQueryUpdate<Row>(client, key, old => ({ ...old, notes: "second" }));
    second.rollback();
    second.finish?.();
    expect(client.getQueryData<Row>(key)?.notes).toBe("before");
  });

  it("does not erase an authoritative refresh that arrives during the write", () => {
    const client = setup();
    const change = beginInstantQueryUpdate<Row, string>(client, key, old => ({ ...old, notes: "mine" }),
      (result, old) => ({ ...old, notes: result }));
    client.setQueryData(key, { notes: "another device", count: 3 });
    change.rollback();
    change.commit?.("mine");
    change.finish?.();
    expect(client.getQueryData(key)).toEqual({ notes: "another device", count: 3 });
  });

  it("cannot repopulate a cleared account or modify the next account's same key", () => {
    for (const recreate of [false, true]) {
      const client = setup();
      const change = beginInstantQueryUpdate<Row, string>(client, key, old => ({ ...old, notes: "private" }),
        (result, old) => ({ ...old, notes: result }));
      client.clear();
      if (recreate) client.setQueryData(key, { notes: "next account", count: 7 });
      change.rollback();
      change.commit?.("private");
      change.finish?.();
      expect(client.getQueryData(key)).toEqual(recreate ? { notes: "next account", count: 7 } : undefined);
    }
  });

  it("does not invent an incomplete record when the query is absent", () => {
    const client = new QueryClient();
    const change = beginInstantQueryUpdate<Row>(client, key, old => ({ ...old, notes: "after" }));
    change.rollback();
    change.finish?.();
    expect(client.getQueryData(key)).toBeUndefined();
  });
});
