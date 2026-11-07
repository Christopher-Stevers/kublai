import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReadTransaction, Replicache } from "replicache";
import { useReplicacheMaterialList } from "./use-replicache-material-list";
const { rep } = vi.hoisted(() => ({ rep: { current: null as unknown } }));
vi.mock("~/lib/replicache-material-list", () => ({
  tryGetMaterialListReplicache: () => rep.current,
  subscribeToMaterialListReplicacheSyncing: () => () => undefined,
}));
afterEach(cleanup);
it("reads only one list's indexes, retains legacy quote lines, and computes totals", async () => {
  const scans: string[] = [];
  const list = { id: "list", quoteId: "quote", name: "Test" };
  const tx = {
    get: async () => list,
    scan: ({ indexName, prefix }: { indexName: string; prefix: string }) => {
      scans.push(`${indexName}:${prefix}`);
      const data =
        indexName === "itemsByList"
          ? [
              {
                id: "a",
                materialListId: "list",
                quantity: "3",
                unitCost: "2",
                extendedPrice: "6",
              },
            ]
          : [
              {
                id: "a",
                materialListId: "list",
                quantity: "3",
                unitCost: "2",
                extendedPrice: "6",
              },
              {
                id: "b",
                materialListId: null,
                quoteId: "quote",
                quantity: "3",
                unitCost: "3",
                extendedPrice: "9",
              },
            ];
      return { values: () => ({ toArray: async () => data }) };
    },
  } as unknown as ReadTransaction;
  rep.current = {
    subscribe: (
      read: (tx: ReadTransaction) => Promise<unknown>,
      options: { onData: (data: unknown) => void },
    ) => {
      void read(tx).then(options.onData);
      return () => undefined;
    },
  } as unknown as Replicache;
  const { result } = renderHook(() => useReplicacheMaterialList("list"));
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.items.map((item) => item.id)).toEqual(["a", "b"]);
  expect(result.current.materialTotal).toBe(15);
  expect(scans).toEqual(["itemsByList:list", "itemsByQuote:quote"]);
});
it("a missing list finishes loading instead of spinning forever", async () => {
  rep.current = {
    subscribe: (
      read: (tx: ReadTransaction) => Promise<unknown>,
      options: { onData: (data: unknown) => void },
    ) => {
      void read({
        get: async () => undefined,
      } as unknown as ReadTransaction).then(options.onData);
      return () => undefined;
    },
  };
  const { result } = renderHook(() => useReplicacheMaterialList("missing"));
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.isLoading).toBe(false);
  expect(result.current.materialList).toBeNull();
});
