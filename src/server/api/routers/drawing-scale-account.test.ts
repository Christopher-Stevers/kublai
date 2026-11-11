// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/simulation/service", () => ({
  recordSimulationAction: vi.fn(async () => null),
}));
const state = vi.hoisted(() => ({ scale: vi.fn() }));
vi.mock("~/server/drawings/service", async (original) => ({
  ...(await original<object>()),
  setDrawingScale: state.scale,
}));
import { drawingsWorkspaceRouter } from "./drawingsWorkspace";
import { liveAccountScope } from "~/lib/live-protocol";
import { TRPCError } from "@trpc/server";
import type { createTRPCContext } from "~/server/api/trpc";
const org = "11111111-1111-4111-8111-111111111111",
  sheetId = "22222222-2222-4222-8222-222222222222",
  scale = { unit: "m" as const, unitsPerSheetWidth: 120 };
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
  state.scale.mockResolvedValue({
    revision: 9,
    scale,
    currentSourceSheetId: sheetId,
  });
});
it("preserves real service ACK, matching actor and legacy omission; strips guard", async () => {
  const result = await caller().setScale({
    sheetId,
    scale,
    expectedAccountKey: liveAccountScope(org, "actor"),
  });
  expect(result).toMatchObject({ revision: 9, scale });
  expect(state.scale).toHaveBeenLastCalledWith(expect.anything(), {
    sheetId,
    scale,
  });
  await caller().setScale({ sheetId, scale });
  expect(state.scale).toHaveBeenCalledTimes(2);
});
it("allows matching full simulation scope", async () => {
  await caller("actor", org, { id: "one" }).setScale({
    sheetId,
    scale,
    expectedAccountKey: liveAccountScope(org, "actor", "one"),
  });
  expect(state.scale).toHaveBeenCalledOnce();
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
      caller(user, organization, simulation).setScale({
        sheetId,
        scale,
        expectedAccountKey: key,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.scale).not.toHaveBeenCalled();
    for (const method of Object.values(database))
      expect(method).not.toHaveBeenCalled();
  });
it("preserves hasAppAccess org approval", async () => {
  await expect(
    caller("actor", org, null, "pending").setScale({
      sheetId,
      scale,
      expectedAccountKey: liveAccountScope(org, "actor"),
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(state.scale).not.toHaveBeenCalled();
});
it("preserves service-level annotation/document refusal rather than acknowledging it", async () => {
  state.scale.mockRejectedValueOnce(
    new TRPCError({
      code: "FORBIDDEN",
      message: "This document version is read only or locked.",
    }),
  );
  await expect(caller().setScale({ sheetId, scale })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
