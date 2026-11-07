import { afterEach, expect, it, vi } from "vitest";
import {
  Replicache,
  type ReadTransaction,
  type WriteTransaction,
} from "replicache";
import {
  MATERIAL_LIST_INDEXES,
  makeMaterialListMutators,
} from "~/lib/replicache-material-list";
import { createJobSummaryStore } from "./use-replicache-jobs";

const instances: Replicache[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((rep) => rep.close()));
});
it("rebuilds only the edited list, retaining legacy rows, offline mutations and shared listeners", async () => {
  const rep = new Replicache({
    name: crypto.randomUUID(),
    kvStore: "mem",
    indexes: MATERIAL_LIST_INDEXES,
    pullInterval: null,
    mutators: {
      ...makeMaterialListMutators(),
      seed: async (tx: WriteTransaction) => {
        await tx.put("job/job", {
          id: "job",
          name: "Alma",
          createdAt: "2026-01-01",
        });
        for (let i = 0; i < 67; i++) {
          await tx.put(`materialList/l${i}`, {
            id: `l${i}`,
            jobId: "job",
            quoteId: `q${i}`,
            createdAt: "2026-01-01",
          });
          await tx.put(`materialListItem/i${i}`, {
            id: `i${i}`,
            materialListId: `l${i}`,
            quoteId: null,
            quantity: "1",
            unitCost: "2",
            extendedPrice: "2",
          });
        }
        await tx.put("materialListItem/legacy", {
          id: "legacy",
          materialListId: null,
          quoteId: "q0",
          quantity: "1",
          extendedPrice: "3",
        });
      },
    },
  });
  instances.push(rep as Replicache);
  await rep.mutate.seed();
  const scans: string[] = [];
  const store = createJobSummaryStore(
    {
      subscribe: (
        read: (tx: ReadTransaction) => Promise<unknown>,
        options: never,
      ) =>
        rep.subscribe(
          (tx) =>
            read(
              new Proxy(tx, {
                get(target, property) {
                  if (property === "scan")
                    return (query: Parameters<ReadTransaction["scan"]>[0]) => {
                      scans.push(JSON.stringify(query));
                      return target.scan(query);
                    };
                  const value: unknown = Reflect.get(target, property);
                  return typeof value === "function"
                    ? (value as (...args: unknown[]) => unknown).bind(target)
                    : value;
                },
              }),
            ),
          options,
        ),
    } as never,
    "job",
  );
  const first = vi.fn(),
    second = vi.fn(),
    stop1 = store.subscribe(first),
    stop2 = store.subscribe(second);
  const list = () =>
    store.get()?.materialLists.find((list) => list.id === "l0");
  await vi.waitFor(() => expect(store.get()?.materialLists).toHaveLength(67));
  expect(scans).toHaveLength(135);
  expect(list()).toMatchObject({ itemCount: 2, materialTotal: 5 });
  scans.length = 0;
  await rep.mutate.updateItemQuantity({
    materialListId: "l0",
    itemId: "i0",
    quantity: 5,
  });
  await vi.waitFor(() => expect(list()?.materialTotal).toBe(13));
  expect(scans).toHaveLength(2);
  expect(
    scans.every((query) => query.includes("l0") || query.includes("q0")),
  ).toBe(true);
  expect(first).toHaveBeenCalled();
  expect(second).toHaveBeenCalled();
  await rep.mutate.removeItem({ materialListId: "l0", itemId: "legacy" });
  await vi.waitFor(() =>
    expect(list()).toMatchObject({ itemCount: 1, materialTotal: 10 }),
  );
  stop1();
  await rep.mutate.renameMaterialList({
    materialListId: "l0",
    name: "Renamed offline",
  });
  await vi.waitFor(() => expect(list()?.name).toBe("Renamed offline"));
  stop2();
  scans.length = 0;
  await rep.mutate.updateItemQuantity({
    materialListId: "l0",
    itemId: "i0",
    quantity: 6,
  });
  expect(scans).toHaveLength(0);
  const stop3 = store.subscribe(vi.fn());
  await vi.waitFor(() => expect(list()?.materialTotal).toBe(12));
  await rep.mutate.deleteMaterialList({ materialListId: "l0" });
  await vi.waitFor(() => expect(store.get()?.materialLists).toHaveLength(66));
  stop3();
});
