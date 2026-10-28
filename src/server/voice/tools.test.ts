import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  apply: vi.fn(),
  can: vi.fn(() => true),
}));
vi.mock("~/server/db", () => ({
  db: { execute: mocks.execute, transaction: mocks.transaction },
}));
vi.mock("~/server/replicache/material-list-sync", () => ({
  applyVoiceMaterialMutation: mocks.apply,
}));
vi.mock("~/server/auth/permissions", () => ({ userCan: mocks.can }));
vi.mock("~/server/documents/access", () => ({
  assertDocumentAccess: vi.fn(),
  documentActor: vi.fn(),
}));
vi.mock("~/server/documents/service", () => ({ readWorkspace: vi.fn() }));
vi.mock("~/server/documents/domain", () => ({ folderRole: vi.fn() }));
import { prepareChange, executeChange, record, navigate } from "./tools";
import type { RequestUser } from "~/server/utils/get-request-identity";
const user = { id: "u", organizationId: "org" } as RequestUser;
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.can.mockReturnValue(true);
  mocks.execute.mockResolvedValue([]);
});
it("blocks inaccessible records and disabled account permissions", async () => {
  await expect(record(user, "job", a)).rejects.toThrow("company");
  mocks.can.mockReturnValue(false);
  await expect(
    prepareChange(user, { action: "createJob", name: "X" }),
  ).rejects.toThrow("permission");
  expect(mocks.apply).not.toHaveBeenCalled();
});
it("does not allow editing an already sent item", async () => {
  mocks.execute
    .mockResolvedValueOnce([{ id: a, quoteId: b, name: "List" }])
    .mockResolvedValueOnce([{ id: b, quantity: 4, sentOrderItemId: a }]);
  await expect(
    prepareChange(user, {
      action: "setQuantity",
      materialListId: a,
      itemId: b,
      quantity: 2,
    }),
  ).rejects.toThrow("Already ordered");
});
it("rejects a room from another job", async () => {
  mocks.execute
    .mockResolvedValueOnce([{ id: a }])
    .mockResolvedValueOnce([{ id: b, jobId: b }]);
  await expect(
    prepareChange(user, {
      action: "createMaterialList",
      jobId: a,
      name: "List",
      roomId: b,
    }),
  ).rejects.toThrow("another job");
});
it("locks and rejects a changed record inside the mutation transaction", async () => {
  const tx = {
    execute: vi.fn().mockResolvedValue([{ id: a, name: "Changed elsewhere" }]),
  };
  mocks.execute.mockResolvedValue([{ id: a, name: "Original" }]);
  const change = { action: "renameJob" as const, jobId: a, name: "New" };
  const preview = await prepareChange(user, change);
  mocks.apply.mockImplementation(
    async (
      _u: unknown,
      _n: unknown,
      _a: unknown,
      check: (r: typeof tx) => Promise<void>,
    ) => {
      await check(tx);
    },
  );
  await expect(
    executeChange(user, change, preview.fingerprint),
  ).rejects.toThrow("changed since");
  expect(tx.execute).toHaveBeenCalledOnce();
});
it("maps approved changes to a narrow existing mutation with no model-supplied dispatch", async () => {
  const tx = {
    execute: vi.fn().mockResolvedValue([{ id: a, name: "Original" }]),
  };
  mocks.execute.mockResolvedValue([{ id: a, name: "Original" }]);
  const change = { action: "renameJob" as const, jobId: a, name: "New" };
  const p = await prepareChange(user, change);
  mocks.apply.mockImplementation(
    async (
      _u: unknown,
      _n: unknown,
      _a: unknown,
      check: (r: typeof tx) => Promise<void>,
    ) => {
      await check(tx);
    },
  );
  await expect(executeChange(user, change, p.fingerprint)).resolves.toContain(
    "Saved",
  );
  expect(mocks.apply).toHaveBeenCalledWith(
    user,
    "updateJob",
    { jobId: a, name: "New" },
    expect.any(Function),
  );
});
it("rejects cross-company navigation", async () => {
  await expect(
    navigate(user, { tool: "navigate", destination: "material-list", id: a }),
  ).rejects.toThrow("company");
});
