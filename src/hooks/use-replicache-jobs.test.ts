import { expect, it, vi } from "vitest";
vi.mock("~/lib/replicache-material-list", () => ({
  tryGetMaterialListReplicache: () => null,
}));
import { indexWorkspaceRecords } from "./use-replicache-jobs";

it("indexes lists once without mixing jobs, including pending and quote-linked items", () => {
  const author = { id: "person", name: "Tim", email: null };
  const jobs = [
    { id: "job1", name: "One", createdAt: "2026-01-01" },
    { id: "job2", name: "Two", createdAt: "2026-01-02" },
  ];
  const lists = [
    { id: "list1", jobId: "job1", quoteId: "quote1", createdBy: author },
    { id: "list2", jobId: "job2", quoteId: "quote2" },
  ];
  const items = [
    {
      id: "one",
      materialListId: "list1",
      quantity: "2",
      extendedPrice: "10.25",
      addedBy: author,
      pendingSync: true,
    },
    {
      id: "two",
      quoteId: "quote1",
      quantity: "1",
      extendedPrice: "4.75",
      addedBy: author,
    },
    {
      id: "three",
      materialListId: "list2",
      quantity: "3",
      extendedPrice: "30",
    },
    {
      id: "bad",
      materialListId: "missing",
      quantity: "1",
      extendedPrice: "900",
    },
  ];
  const value = indexWorkspaceRecords(jobs, lists, items);
  expect(value.jobs.map((j) => [j.id, j.materialListCount])).toEqual([
    ["job2", 1],
    ["job1", 1],
  ]);
  expect(value.lists.list1?.materialTotal).toBe(15);
  expect(value.lists.list1?.items[0]?.pendingSync).toBe(true);
  expect(value.details.job1?.materialLists[0]?.contributors).toEqual([author]);
  expect(value.lists.list2?.materialTotal).toBe(30);
  const next = indexWorkspaceRecords(jobs, lists, items.slice(1));
  expect(next.lists.list1?.materialTotal).toBe(4.75);
  expect(next.details.job1?.materialLists[0]?.itemCount).toBe(1);
});
