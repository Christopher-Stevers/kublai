// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/simulation/service", () => ({
  recordSimulationAction: vi.fn(async () => null),
}));
vi.mock("~/server/drawings/service", () => ({
  assertSheetsNotReferenced: vi.fn(),
}));
vi.mock("~/server/rooms/tiles", () => ({
  ensureDrawingTiles: vi.fn(),
  uploadsFromImageUrls: vi.fn(),
}));
const checks = vi.hoisted(() => ({
  assert: vi.fn(),
  allowed: vi.fn(() => true),
}));
vi.mock("~/server/auth/permissions", () => ({
  assertCan: checks.assert,
  userCan: checks.allowed,
}));
import { drawingsRouter } from "./drawings";
import { liveAccountScope } from "~/lib/live-protocol";
import type { createTRPCContext } from "~/server/api/trpc";
const org = "11111111-1111-4111-8111-111111111111",
  jobId = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
const values = vi.fn();
const database = {
  select: vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => [{ id: jobId }] }) }),
  })),
  insert: vi.fn(() => ({
    values: (v: unknown) => {
      values(v);
      return { returning: async () => [{ id }] };
    },
  })),
};
function caller(
  userId = "actor",
  organizationId = org,
  simulation: { id: string } | null = null,
) {
  return drawingsRouter.createCaller({
    db: database,
    userId,
    user: {
      id: userId,
      organizationId,
      organizationAccessStatus: "approved",
      role: "admin",
    },
    simulation,
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>);
}
beforeEach(() => {
  vi.clearAllMocks();
  checks.allowed.mockReturnValue(true);
});
it("accepts matching actor and legacy omission without persisting guard field", async () => {
  await expect(
    caller().createSet({
      jobId,
      name: "Folder",
      expectedAccountKey: liveAccountScope(org, "actor"),
    }),
  ).resolves.toEqual({ id });
  expect(values.mock.calls[0]?.[0]).not.toHaveProperty("expectedAccountKey");
  await expect(caller().createSet({ jobId, name: "Legacy" })).resolves.toEqual({
    id,
  });
  expect(database.insert).toHaveBeenCalledTimes(2);
});
it("accepts only matching simulation identity", async () => {
  await expect(
    caller("actor", org, { id: "one" }).createSet({
      jobId,
      name: "Folder",
      expectedAccountKey: liveAccountScope(org, "actor", "one"),
    }),
  ).resolves.toEqual({ id });
});
for (const [label, user, organization, simulation, key] of [
  ["user", "other", org, null, liveAccountScope(org, "actor")],
  ["organization", "actor", jobId, null, liveAccountScope(org, "actor")],
  [
    "direct to simulation",
    "actor",
    org,
    { id: "one" },
    liveAccountScope(org, "actor"),
  ],
  [
    "simulation to direct",
    "actor",
    org,
    null,
    liveAccountScope(org, "actor", "one"),
  ],
  [
    "simulation swap",
    "actor",
    org,
    { id: "two" },
    liveAccountScope(org, "actor", "one"),
  ],
] as const)
  it(`rejects stale ${label} before permissions/DB`, async () => {
    await expect(
      caller(user, organization, simulation).createSet({
        jobId,
        name: "No write",
        expectedAccountKey: key,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(checks.assert).not.toHaveBeenCalled();
    expect(checks.allowed).not.toHaveBeenCalled();
    expect(database.select).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
  });
it("preserves manage and parent/job authorization after identity guard", async () => {
  checks.allowed.mockReturnValue(false);
  await expect(
    caller().createSet({
      jobId,
      name: "Denied",
      expectedAccountKey: liveAccountScope(org, "actor"),
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(database.insert).not.toHaveBeenCalled();
});

it("preserves missing-job refusal after a matching actor guard", async () => {
  database.select.mockImplementationOnce(() => ({
    from: () => ({ where: () => ({ limit: async () => [] }) }),
  }));
  await expect(
    caller().createSet({
      jobId,
      name: "Denied",
      expectedAccountKey: liveAccountScope(org, "actor"),
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(database.insert).not.toHaveBeenCalled();
});
it("preserves same-job parent validation before inserting", async () => {
  database.select.mockImplementationOnce(() => ({
    from: () => ({ where: () => ({ limit: async () => [{ id: jobId }] }) }),
  }));
  database.select.mockImplementationOnce(() => ({
    from: () => ({
      where: () => ({ limit: async () => [{ id, jobId: org }] }),
    }),
  }));
  await expect(
    caller().createSet({
      jobId,
      parentId: id,
      name: "Denied",
      expectedAccountKey: liveAccountScope(org, "actor"),
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(database.insert).not.toHaveBeenCalled();
});
