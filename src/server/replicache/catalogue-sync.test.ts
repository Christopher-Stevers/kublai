// @vitest-environment node
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { CATALOGUE_REPLICACHE_SCHEMA_VERSION } from "~/lib/replicache-schema";
import { partSynonyms } from "~/server/db/schema";
import { pullSnapshot } from "./pull";
import { handleCatalogueReplicachePull } from "./catalogue-sync";

vi.mock("./pull", () => ({ pullSnapshot: vi.fn() }));

it("downloads aliases with each active organization's part in one bulk query, including empty aliases", async () => {
  const reads: unknown[][] = [[], [], [], [], [
    { id: "part-a", displayName: "Clip", organizationId: "org" },
    { id: "part-b", displayName: "Valve", organizationId: "org" },
  ], [
    { partDefinitionId: "part-a", synonym: "hanger" },
    { partDefinitionId: "part-a", synonym: "pipe strap" },
  ]];
  const filters: { table: unknown; condition: SQL }[] = [];
  const tx = { select: vi.fn(() => {
    const rows = reads.shift();
    if (!rows) throw new Error("Unexpected query");
    let table: unknown;
    const query = Object.assign(Promise.resolve(rows), {
      from: (value: unknown) => { table = value; return query; },
      innerJoin: () => query,
      leftJoin: () => query,
      where: (condition: SQL) => { filters.push({ table, condition }); return query; },
      orderBy: () => query,
    });
    return query;
  }) };
  vi.mocked(pullSnapshot).mockImplementation(async (_kind, _request, _user, build) => ({
    cookie: null, lastMutationIDChanges: {}, patch: await build(tx as never),
  }));
  const response = await handleCatalogueReplicachePull({
    profileID: "profile", clientGroupID: "group", pullVersion: 1,
    schemaVersion: CATALOGUE_REPLICACHE_SCHEMA_VERSION, cookie: null,
  }, { id: "user", organizationId: "org" });
  if (!("patch" in response)) throw new Error("Pull failed");
  expect(response.patch.find(op => op.op === "put" && op.key === "cataloguePart/part-a"))
    .toMatchObject({ value: { aliases: ["hanger", "pipe strap"] } });
  expect(response.patch.find(op => op.op === "put" && op.key === "cataloguePart/part-b"))
    .toMatchObject({ value: { aliases: [] } });
  expect(tx.select).toHaveBeenCalledTimes(6);
  const aliasFilter = filters.find(filter => filter.table === partSynonyms)!;
  const sql = new PgDialect().sqlToQuery(aliasFilter.condition);
  expect(sql.params).toEqual(["org", true]);
  expect(sql.sql).toContain('"organizationId"');
  expect(sql.sql).toContain('"isActive"');
});
