// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/simulation/service", () => ({
  recordSimulationAction: vi.fn(async () => null),
}));
const store = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("~/server/material-sort-preferences", () => ({
  readMaterialSortPreferences: store.read,
  saveMaterialSortPreferences: store.save,
}));
import { userRouter } from "./user";
import type { createTRPCContext } from "~/server/api/trpc";
import { defaultMaterialSortSettings } from "~/lib/material-sort-preferences";
const org = "00000000-0000-4000-8000-000000000001";
const input = {
  expectedUserId: "crew",
  expectedOrganizationId: org,
  target: "personal" as const,
  settings: defaultMaterialSortSettings,
  custom: true,
};
function caller(
  patch: Record<string, unknown> = {},
  simulation: unknown = null,
) {
  return userRouter.createCaller({
    userId: "crew",
    user: {
      id: "crew",
      organizationId: org,
      organizationAccessStatus: "approved",
      role: "user",
      ...patch,
    },
    db: {},
    headers: new Headers(),
    simulation,
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>);
}
beforeEach(() => {
  store.read
    .mockReset()
    .mockResolvedValue({
      shared: defaultMaterialSortSettings,
      personal: null,
      custom: false,
      initialized: true,
    });
  store.save.mockReset();
});
it("allows a member to opt in only for their authenticated account", async () => {
  await caller().setMaterialSortPreferences(input);
  expect(store.save).toHaveBeenCalledWith(
    expect.anything(),
    org,
    "crew",
    input.settings,
    true,
    false,
  );
});
it("rejects stale user and organization identities before writing", async () => {
  await expect(
    caller().setMaterialSortPreferences({
      ...input,
      expectedUserId: "another",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller().setMaterialSortPreferences({
      ...input,
      expectedOrganizationId: "00000000-0000-4000-8000-000000000002",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(store.save).not.toHaveBeenCalled();
});
it("forbids members and simulated executives from publishing shared defaults", async () => {
  await expect(
    caller().setMaterialSortPreferences({ ...input, target: "executive" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller({ role: "admin" }, { id: "simulation" }).setMaterialSortPreferences({
      ...input,
      target: "executive",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(store.save).not.toHaveBeenCalled();
});
it("allows the executive to publish the organization default", async () => {
  await caller({ role: "admin" }).setMaterialSortPreferences({
    ...input,
    target: "executive",
  });
  expect(store.save).toHaveBeenCalledWith(
    expect.anything(),
    org,
    "executive",
    input.settings,
    true,
    false,
  );
});
it("denies accounts awaiting organization approval", async () => {
  await expect(
    caller({ organizationAccessStatus: "pending" }).getMaterialSortPreferences(
      input,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(store.read).not.toHaveBeenCalled();
});
