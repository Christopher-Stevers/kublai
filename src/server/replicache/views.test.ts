import { expect, it, vi, afterEach } from "vitest";
import { ReplicacheViews } from "./views";
import type { PatchOperation } from "replicache";
const put = (key: string, n: number): PatchOperation => ({
  op: "put",
  key,
  value: { n },
});
afterEach(() => vi.useRealTimers());
it("keeps actively pulled snapshots past their original TTL and expires them after inactivity", () => {
  vi.useFakeTimers();
  const store = new ReplicacheViews(100_000, 50);
  const active = store.create("org-a", "1", [put("a", 1)]);
  const idle = store.create("org-b", "1", [put("b", 1)]);
  store.remember(active); store.remember(idle);
  for (let n = 0; n < 5; n++) {
    vi.advanceTimersByTime(40);
    expect(store.find("org-a", "1")).toBe(active);
    expect(store.diff(active, { cvr: active.id })).toEqual([]);
    store.remember(active);
  }
  expect(store.find("org-b", "1")).toBeUndefined();
  vi.advanceTimersByTime(51);
  expect(store.find("org-a", "1")).toBeUndefined();
  expect(store.diff(active, { cvr: active.id })[0]).toEqual({ op: "clear" });
});
it("diffs against the client's exact view, including missed revisions and deletions", () => {
  const store = new ReplicacheViews();
  const a = store.create("org-a", "1", [put("a", 1), put("b", 2)]);
  store.remember(a);
  const b = store.create("org-a", "2", [put("a", 3), put("b", 2)]);
  store.remember(b);
  const c = store.create("org-a", "3", [put("a", 4), put("c", 5)]);
  expect(store.diff(c, { cvr: a.id })).toEqual([
    { op: "del", key: "b" },
    put("a", 4),
    put("c", 5),
  ]);
  expect(store.diff(a, { cvr: a.id })).toEqual([]);
  // An interrupted response must not advance the old client's base.
  expect(store.diff(b, { cvr: a.id })).toEqual([put("a", 3)]);
});
it("self-heals old, foreign, expired, and evicted cookies", () => {
  vi.useFakeTimers();
  const store = new ReplicacheViews(100_000, 50);
  const a = store.create("org-a", "1", [put("a", 1)]);
  store.remember(a);
  const b = store.create("org-b", "1", [put("b", 2)]);
  expect(store.diff(b, { cvr: a.id })).toEqual([{ op: "clear" }, put("b", 2)]);
  expect(store.diff(a, { cvr: "old-client-group" })).toEqual([
    { op: "clear" },
    put("a", 1),
  ]);
  vi.advanceTimersByTime(51);
  expect(store.diff(a, { cvr: a.id })[0]).toEqual({ op: "clear" });
  const tiny = new ReplicacheViews(1);
  tiny.remember(a);
  expect(tiny.diff(a, { cvr: a.id })[0]).toEqual({ op: "clear" });
});
