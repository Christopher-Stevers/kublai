// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/simulation/service", () => ({
  recordSimulationAction: vi.fn(async () => null),
}));
vi.mock("~/server/material-list-events", () => ({
  publishOrganizationCatalogueEvent: vi.fn(),
}));
const guards = vi.hoisted(() => ({ edit: vi.fn(), remove: vi.fn() }));
vi.mock("~/server/auth/permissions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertCanEditParts: guards.edit,
  assertCanDeleteParts: guards.remove,
}));
import { catalogueRouter } from "./catalogue";
import type { createTRPCContext } from "~/server/api/trpc";
import { liveAccountScope } from "~/lib/live-protocol";
const org = "11111111-1111-4111-8111-111111111111",
  otherOrg = "22222222-2222-4222-8222-222222222222",
  partId = "33333333-3333-4333-8333-333333333333";
const row = {
  id: partId,
  organizationId: org,
  catalogId: org,
  materialId: null,
  sizeId: null,
};
const updateFields = vi.fn();
const database = {
  select: vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => [row] }) }),
  })),
  update: vi.fn(() => ({
    set: (value: unknown) => {
      updateFields(value);
      return {
        where: () => ({ returning: async () => [{ ...row, imageUrl: null }] }),
      };
    },
  })),
  insert: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
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
beforeEach(() => {
  vi.clearAllMocks();
});

it("accepts a matching direct account key and keeps legacy omission compatible", async () => {
  await expect(
    caller().updatePart({
      partId,
      description: "photo-independent legacy field",
      expectedAccountKey: liveAccountScope(org, "actor"),
    }),
  ).resolves.toMatchObject({ id: partId });
  expect(guards.edit).toHaveBeenCalledOnce();
  expect(database.update).toHaveBeenCalledOnce();
  expect(updateFields.mock.calls[0]?.[0]).not.toHaveProperty(
    "expectedAccountKey",
  );
  await expect(
    caller().updatePart({ partId, description: "legacy caller" }),
  ).resolves.toMatchObject({ id: partId });
  expect(database.update).toHaveBeenCalledTimes(2);
});
it("accepts only the matching simulation identity", async () => {
  await expect(
    caller("actor", org, { id: "simulation-one" }).updatePart({
      partId,
      description: "same simulation",
      expectedAccountKey: liveAccountScope(org, "actor", "simulation-one"),
    }),
  ).resolves.toMatchObject({ id: partId });
  expect(database.update).toHaveBeenCalledOnce();
});
for (const [name, user, organization, simulation] of [
  ["different user", "other", org, null],
  ["different organization", "actor", otherOrg, null],
  ["direct-to-simulation", "actor", org, { id: "simulation-one" }],
] as const)
  it(`rejects ${name} before permissions or any database work`, async () => {
    await expect(
      caller(user, organization, simulation).updatePart({
        partId,
        description: "must not write",
        expectedAccountKey: liveAccountScope(org, "actor"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(guards.edit).not.toHaveBeenCalled();
    expect(guards.remove).not.toHaveBeenCalled();
    for (const method of Object.values(database))
      expect(method).not.toHaveBeenCalled();
  });
for (const simulation of [null, { id: "simulation-two" }])
  it(`rejects stale simulation key for ${simulation ? "another simulation" : "direct session"} before DB work`, async () => {
    await expect(
      caller("actor", org, simulation).updatePart({
        partId,
        description: "must not write",
        expectedAccountKey: liveAccountScope(org, "actor", "simulation-one"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(guards.edit).not.toHaveBeenCalled();
    for (const method of Object.values(database))
      expect(method).not.toHaveBeenCalled();
  });
