// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/simulation/service", () => ({
  recordSimulationAction: vi.fn(async () => null),
}));
vi.mock("~/server/material-list-events", () => ({
  publishOrganizationCatalogueEvent: vi.fn(),
}));
const createPermission = vi.hoisted(() => vi.fn());
vi.mock("~/server/auth/permissions", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  assertCanCreateParts: createPermission,
}));
import { catalogueRouter } from "./catalogue";
import {
  catalogs,
  suppliers,
  supplierParts,
  partDefinitions,
} from "~/server/db/schema";
import type { createTRPCContext } from "~/server/api/trpc";
import { liveAccountScope } from "~/lib/live-protocol";
const org = "11111111-1111-4111-8111-111111111111";
const partId = "22222222-2222-4222-8222-222222222222";
const supplierId = "33333333-3333-4333-8333-333333333333";
const linkId = "44444444-4444-4444-8444-444444444444";
let existingLink = false;
const savedFields = vi.fn();
const database = {
  select: vi.fn(() => ({
    from: (table: unknown) => {
      const builder = {
        leftJoin: () => builder,
        where: () => builder,
        limit: async () =>
          table === catalogs
            ? [{ id: org, kind: "materials" }]
            : table === suppliers
              ? [{ id: supplierId }]
              : table === supplierParts
                ? existingLink
                  ? [{ id: linkId }]
                  : []
                : [{ id: partId, displayName: "Valve", organizationId: org }],
      };
      return builder;
    },
  })),
  insert: vi.fn((table: unknown) => ({
    values: (values: unknown) => {
      savedFields(table, values);
      return {
        returning: async () => [
          { id: table === partDefinitions ? partId : linkId },
        ],
      };
    },
  })),
};
function caller(
  userId = "actor",
  organizationId = org,
  simulation: { id: string } | null = null,
) {
  return catalogueRouter.createCaller({
    userId,
    user: {
      id: userId,
      organizationId,
      organizationAccessStatus: "approved",
      role: "admin",
    },
    db: database,
    headers: new Headers(),
    simulation,
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>);
}
const input = { displayName: "Valve", catalogId: org, supplierId };
beforeEach(() => {
  vi.clearAllMocks();
  existingLink = false;
});
for (const key of [undefined, liveAccountScope(org, "actor")])
  it(`returns the real newly created supplier link (${key ? "guarded" : "legacy"})`, async () => {
    await expect(
      caller().createPart({ ...input, expectedAccountKey: key }),
    ).resolves.toMatchObject({ id: partId, supplierPartId: linkId });
    expect(createPermission).toHaveBeenCalledOnce();
    expect(database.insert).toHaveBeenCalledTimes(2);
    for (const [, fields] of savedFields.mock.calls)
      expect(fields).not.toHaveProperty("expectedAccountKey");
  });
it("returns an existing accepted supplier link without inserting another", async () => {
  existingLink = true;
  await expect(caller().createPart(input)).resolves.toMatchObject({
    id: partId,
    supplierPartId: linkId,
  });
  expect(database.insert).toHaveBeenCalledExactlyOnceWith(partDefinitions);
});
it("does not invent a supplier link when none was requested", async () => {
  const result = await caller().createPart({
    displayName: "Valve",
    catalogId: org,
  });
  expect(result.id).toBe(partId);
  expect(result.supplierPartId).toBeUndefined();
  expect(database.insert).toHaveBeenCalledExactlyOnceWith(partDefinitions);
});
it("accepts the exact simulation actor", async () => {
  await expect(
    caller("actor", org, { id: "sim" }).createPart({
      ...input,
      expectedAccountKey: liveAccountScope(org, "actor", "sim"),
    }),
  ).resolves.toMatchObject({ id: partId });
});
for (const [user, organization, simulation, key] of [
  ["other", org, null, liveAccountScope(org, "actor")],
  ["actor", supplierId, null, liveAccountScope(org, "actor")],
  ["actor", org, { id: "sim" }, liveAccountScope(org, "actor")],
  ["actor", org, null, liveAccountScope(org, "actor", "sim")],
] as const)
  it(`refuses changed actor before permissions or writes: ${user}/${organization}/${simulation?.id ?? "direct"}`, async () => {
    await expect(
      caller(user, organization, simulation).createPart({
        ...input,
        expectedAccountKey: key,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(createPermission).not.toHaveBeenCalled();
    expect(database.select).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
  });
