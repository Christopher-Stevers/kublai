// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/material-list-events", () => ({
  publishOrganizationCatalogueEvent: vi.fn(),
}));
import { catalogueRouter } from "./catalogue";
import type { createTRPCContext } from "~/server/api/trpc";
import { publishOrganizationCatalogueEvent } from "~/server/material-list-events";
const org = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const foreign = "00000000-0000-4000-8000-000000000003";
function setup(owned: { id: string }[], permission = true) {
  const where = vi.fn((_predicate: SQL) => ({ for: vi.fn(async () => owned) }));
  const writeWhere = vi.fn(async (_predicate: SQL) => undefined);
  const set = vi.fn(() => ({ where: writeWhere }));
  const tx = {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    update: vi.fn(() => ({ set })),
  };
  const db = {
    transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
  };
  const context = {
    db,
    userId: "user",
    user: {
      id: "user",
      organizationId: org,
      role: "user",
      organizationAccessStatus: "approved",
      permissionConfig: { actions: { canEditParts: permission } },
    },
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>;
  return {
    caller: catalogueRouter.createCaller(context),
    db,
    tx,
    set,
    where,
    writeWhere,
  };
}
beforeEach(() => vi.mocked(publishOrganizationCatalogueEvent).mockClear());
it("rejects unauthorized group changes before starting a transaction", async () => {
  const test = setup([{ id }], false);
  await expect(
    test.caller.setMaterialGroups({
      assignments: [{ materialId: id, groupPath: ["PVC"] }],
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(test.db.transaction).not.toHaveBeenCalled();
});
it("rejects foreign or missing material IDs atomically", async () => {
  const test = setup([{ id }]);
  await expect(
    test.caller.setMaterialGroups({
      assignments: [
        { materialId: id, groupPath: ["PVC"] },
        { materialId: foreign, groupPath: ["PVC"] },
      ],
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(test.tx.update).not.toHaveBeenCalled();
  expect(publishOrganizationCatalogueEvent).not.toHaveBeenCalled();
  expect(
    new PgDialect().sqlToQuery(test.where.mock.calls[0]![0]).params,
  ).toContain(org);
});
it("saves nested groups with organization checks and publishes a sync notification", async () => {
  const test = setup([{ id }]);
  await expect(
    test.caller.setMaterialGroups({
      assignments: [{ materialId: id, groupPath: [" PVC ", "Gasketed SDR"] }],
    }),
  ).resolves.toEqual({ updated: 1 });
  expect(test.set).toHaveBeenCalledWith({ groupPath: ["PVC", "Gasketed SDR"] });
  expect(
    new PgDialect().sqlToQuery(test.writeWhere.mock.calls[0]![0]).params,
  ).toContain(org);
  expect(publishOrganizationCatalogueEvent).toHaveBeenCalled();
});
it("rejects duplicate materials and invalid group paths", async () => {
  const test = setup([{ id }]);
  await expect(
    test.caller.setMaterialGroups({
      assignments: [
        { materialId: id, groupPath: [] },
        { materialId: id, groupPath: ["PVC"] },
      ],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    test.caller.setMaterialGroups({
      assignments: [{ materialId: id, groupPath: [""] }],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(test.db.transaction).not.toHaveBeenCalled();
});
