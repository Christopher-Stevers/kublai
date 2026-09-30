import { expect, it, vi } from "vitest";
import { QuantityJournal, type QuantityIntent } from "./quantity-journal";
function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
  } as Storage;
}
it("journals before a deferred mutation and recovers it after a reload", async () => {
  const disk = storage();
  const old = new QuantityJournal("account-a", disk, {
    apply: () => new Promise(() => undefined),
    observe: () => () => undefined,
    sync: vi.fn(),
  });
  void old.save({ itemId: "item", materialListId: "list", quantity: 37 });
  expect(disk.length).toBe(1);
  let deliver!: (row: { quantity: string; pendingSync?: boolean }) => void;
  const apply = vi
    .fn<(intent: QuantityIntent) => Promise<void>>()
    .mockResolvedValue(undefined);
  const stop = vi.fn(),
    sync = vi.fn();
  const next = new QuantityJournal("account-a", disk, {
    apply,
    observe: (_id, onData) => {
      deliver = onData;
      return stop;
    },
    sync,
  });
  next.recover();
  deliver({ quantity: "2" });
  await Promise.resolve();
  expect(apply.mock.calls[0]?.[0].quantity).toBe(37);
  deliver({ quantity: "37", pendingSync: true });
  expect(disk.length).toBe(1);
  deliver({ quantity: "37", pendingSync: false });
  expect(disk.length).toBe(0);
  expect(stop).toHaveBeenCalled();
  expect(sync).toHaveBeenCalled();
});
it("does not replay another account's journal", async () => {
  const disk = storage();
  const first = new QuantityJournal("account-a", disk, {
    apply: () => new Promise(() => undefined),
    observe: () => () => undefined,
    sync: vi.fn(),
  });
  void first.save({ itemId: "item", materialListId: "list", quantity: 5 });
  const observe = vi.fn(() => () => undefined);
  new QuantityJournal("account-b", disk, {
    apply: vi.fn(),
    observe,
    sync: vi.fn(),
  }).recover();
  expect(observe).not.toHaveBeenCalled();
  expect(disk.length).toBe(1);
  await Promise.resolve();
});
it("an older acknowledgment cannot delete a newer quantity intent", async () => {
  const disk = storage();
  const listeners: Array<
    (row: { quantity: string; pendingSync?: boolean }) => void
  > = [];
  const journal = new QuantityJournal("account", disk, {
    apply: async () => undefined,
    observe: (_id, onData) => {
      listeners.push(onData);
      return () => undefined;
    },
    sync: vi.fn(),
  });
  await journal.save({ itemId: "item", materialListId: "list", quantity: 3 });
  await journal.save({ itemId: "item", materialListId: "list", quantity: 30 });
  listeners[0]!({ quantity: "3" });
  expect(disk.length).toBe(1);
  listeners[1]!({ quantity: "30" });
  expect(disk.length).toBe(0);
});
it("storage failure is reported before falsely accepting an edit", async () => {
  const disk = storage();
  disk.setItem = () => {
    throw Error("quota");
  };
  const apply = vi.fn();
  const journal = new QuantityJournal("account", disk, {
    apply,
    observe: () => () => undefined,
    sync: vi.fn(),
  });
  await expect(
    journal.save({ itemId: "item", materialListId: "list", quantity: 7 }),
  ).rejects.toThrow("quota");
  expect(apply).not.toHaveBeenCalled();
});
