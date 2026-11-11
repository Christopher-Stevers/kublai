// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/simulation/service", () => ({
  recordSimulationAction: vi.fn(async () => null),
}));
const state = vi.hoisted(() => ({ issue: vi.fn() }));
vi.mock("~/server/drawings/service", async (original) => ({
  ...(await original<object>()),
  saveDrawingEntity: state.issue,
}));
import { drawingsWorkspaceRouter } from "./drawingsWorkspace";
import { liveAccountScope } from "~/lib/live-protocol";
import { TRPCError } from "@trpc/server";
import type { createTRPCContext } from "~/server/api/trpc";
const org = "11111111-1111-4111-8111-111111111111",
  sheetId = "22222222-2222-4222-8222-222222222222",
  issue = {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "issue" as const,
    visibility: "published" as const,
    expectedRevision: 4,
    data: {
      sourceSheetId: sheetId,
      type: "issue" as const,
      point: { x: 0.5, y: 0.5 },
      title: "Updated issue",
    },
  };
const database = { select: vi.fn(), transaction: vi.fn(), execute: vi.fn() };
function caller(
  userId = "actor",
  organizationId = org,
  simulation: { id: string } | null = null,
  status = "approved",
) {
  return drawingsWorkspaceRouter.createCaller({
    userId,
    user: {
      id: userId,
      organizationId,
      organizationAccessStatus: status,
      role: "admin",
    },
    simulation,
    db: database,
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>);
}
beforeEach(() => {
  vi.clearAllMocks();
  state.issue.mockResolvedValue({
    ...issue,
    sheetId,
    revision: 5,
    authorId: "actor",
  });
});
it("preserves real service ACK, matching actor and legacy omission; strips guard", async () => {
  const result = await caller().save({
    sheetId,
    ...issue,
    expectedAccountKey: liveAccountScope(org, "actor"),
  });
  expect(result).toMatchObject({ id: issue.id, revision: 5 });
  expect(state.issue).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ sheetId, id: issue.id, kind: "issue" }),
  );
  expect(state.issue.mock.lastCall?.[1]).not.toHaveProperty(
    "expectedAccountKey",
  );
  await caller().save({ sheetId, ...issue });
  expect(state.issue).toHaveBeenCalledTimes(2);
});
it("allows matching full simulation scope", async () => {
  await caller("actor", org, { id: "one" }).save({
    sheetId,
    ...issue,
    expectedAccountKey: liveAccountScope(org, "actor", "one"),
  });
  expect(state.issue).toHaveBeenCalledOnce();
});
for (const [label, user, organization, simulation, key] of [
  ["user", "other", org, null, liveAccountScope(org, "actor")],
  ["org", "actor", sheetId, null, liveAccountScope(org, "actor")],
  ["direct/sim", "actor", org, { id: "one" }, liveAccountScope(org, "actor")],
  ["sim/direct", "actor", org, null, liveAccountScope(org, "actor", "one")],
  [
    "sim/sim",
    "actor",
    org,
    { id: "two" },
    liveAccountScope(org, "actor", "one"),
  ],
] as const)
  it(`rejects stale ${label} before sheet service/DB work`, async () => {
    await expect(
      caller(user, organization, simulation).save({
        sheetId,
        ...issue,
        expectedAccountKey: key,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.issue).not.toHaveBeenCalled();
    for (const method of Object.values(database))
      expect(method).not.toHaveBeenCalled();
  });
it("preserves hasAppAccess org approval", async () => {
  await expect(
    caller("actor", org, null, "pending").save({
      sheetId,
      ...issue,
      expectedAccountKey: liveAccountScope(org, "actor"),
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(state.issue).not.toHaveBeenCalled();
});
it("preserves service-level annotation/document refusal rather than acknowledging it", async () => {
  state.issue.mockRejectedValueOnce(
    new TRPCError({
      code: "FORBIDDEN",
      message: "This document version is read only or locked.",
    }),
  );
  await expect(caller().save({ sheetId, ...issue })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
