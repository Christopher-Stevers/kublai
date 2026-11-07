import { expect, it, vi } from "vitest";
import type { ReadTransaction } from "replicache";
vi.mock("~/lib/replicache-material-list", () => ({
  tryGetMaterialListReplicache: () => null,
}));
import { indexWorkspaceRecords, readJobDetail } from "./use-replicache-jobs";

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

it("shows departments of line-item adders, excluding the creator alone, and updates when items are removed", () => {
  const jobs=[{id:"job",name:"One"},{id:"other",name:"Two"}];
  const lists=[{id:"list",jobId:"job",quoteId:"quote",createdBy:{id:"creator",department:"Office"}},{id:"empty",jobId:"job",createdBy:{id:"creator",department:"Office"}},{id:"other-list",jobId:"other"}];
  const items=[
    {id:"a",materialListId:"list",quantity:"1",addedBy:{id:"plumber",department:" Plumbing "}},
    {id:"b",quoteId:"quote",quantity:"1",addedBy:{id:"plumber2",department:"plumbing"}},
    {id:"c",materialListId:"list",quantity:"1",pendingSync:true,addedBy:{id:"hvac",department:"HVAC"}},
    {id:"d",materialListId:"list",quantity:"1",addedBy:{id:"unknown",department:" "}},
    {id:"e",materialListId:"other-list",quantity:"1",addedBy:{id:"electric",department:"Electrical"}},
  ];
  const result=indexWorkspaceRecords(jobs,lists,items);
  expect(result.details.job?.materialLists.find(list=>list.id==="list")?.departments).toEqual(["HVAC","Plumbing"]);
  expect(result.details.job?.materialLists.find(list=>list.id==="empty")?.departments).toEqual([]);
  expect(result.details.other?.materialLists[0]?.departments).toEqual(["Electrical"]);
  const updated=indexWorkspaceRecords(jobs,lists,items.filter(item=>item.id!=="c"));
  expect(updated.details.job?.materialLists.find(list=>list.id==="list")?.departments).toEqual(["Plumbing"]);
});

it("uses an item contributor's department when the cached creator is missing it", () => {
 const author={id:"person",name:"Luca",email:null};
 const result=indexWorkspaceRecords([{id:"job",name:"Job"}],[{id:"list",jobId:"job",createdBy:author}],[{id:"item",materialListId:"list",quantity:"1",addedBy:{...author,department:"Plumbing"}}]);
 expect(result.details.job?.materialLists[0]?.contributors).toEqual([{...author,department:"Plumbing"}]);
});

it("menu readers never scan material items, and inactive readers do no database work", async () => {
  const lists = Array.from({ length: 67 }, (_, n) => ({
    id: `list-${n}`,
    jobId: "job",
    quoteId: `quote-${n}`,
    createdAt: "2026-01-01",
  }));
  const get = vi.fn(async () => ({
    id: "job",
    name: "Alma",
    createdAt: "2026-01-01",
  }));
  const scan = vi.fn(({ indexName }: { indexName: string }) => ({
    values: () => ({
      toArray: async () => (indexName === "listsByJob" ? lists : []),
    }),
  }));
  const tx = { get, scan } as unknown as ReadTransaction;
  const menu = await readJobDetail(tx, "job", false);
  expect(menu?.materialLists).toHaveLength(67);
  expect(scan.mock.calls.map(([query]) => query.indexName)).toEqual([
    "listsByJob",
  ]);
  scan.mockClear();
  get.mockClear();
  expect(await readJobDetail(tx, "", true)).toBeNull();
  expect(scan).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  await readJobDetail(tx, "job", true);
  expect(scan).toHaveBeenCalledTimes(135); // one list index + two legacy-compatible indexes per list
});

it("full list reads retain legacy quote-linked items while excluding items already assigned to another list", async () => {
  const items = [
    {
      id: "explicit",
      materialListId: "l",
      quoteId: "q",
      quantity: "1",
      extendedPrice: "5",
    },
    {
      id: "legacy",
      materialListId: null,
      quoteId: "q",
      quantity: "2",
      extendedPrice: "10",
    },
    {
      id: "other",
      materialListId: "other",
      quoteId: "q",
      quantity: "3",
      extendedPrice: "100",
    },
  ];
  const tx = {
    get: async () => ({ id: "job", name: "Job" }),
    scan: ({ indexName }: { indexName: string }) => ({
      values: () => ({
        toArray: async () =>
          indexName === "listsByJob"
            ? [{ id: "l", jobId: "job", quoteId: "q" }]
            : indexName === "itemsByList"
              ? [items[0]]
              : items,
      }),
    }),
  } as unknown as ReadTransaction;
  expect((await readJobDetail(tx, "job"))?.materialLists[0]).toMatchObject({
    itemCount: 2,
    materialTotal: 15,
  });
});
