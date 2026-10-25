// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
import { materialListRouter } from "./materialList";
import { toStoredConfig } from "~/server/auth/permissions";
import type { PermissionMap } from "~/lib/permission-catalog";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
function setup(permissions: Partial<PermissionMap>) {
  const db = { select: vi.fn(), update: vi.fn(), transaction: vi.fn() };
  const caller = materialListRouter.createCaller({
    db,
    userId: "member",
    headers: new Headers(),
    user: {
      id: "member",
      organizationId: id,
      organizationAccessStatus: "approved",
      role: "user",
      permissionConfig: toStoredConfig(permissions),
    },
  } as never);
  return { caller, db };
}

it("cannot use merge to delete a list with only create permission", async () => {
  const { caller, db } = setup({ "lists.edit": true, "lists.delete": false });
  await expect(
    caller.merge({ sourceId: id, targetId: otherId }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(db.transaction).not.toHaveBeenCalled();
});

it("cannot create copies or merge with only delete permission", async () => {
  const { caller, db } = setup({ "lists.edit": false, "lists.delete": true });
  await expect(caller.duplicate({ materialListId: id })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    caller.merge({ sourceId: id, targetId: otherId }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(db.transaction).not.toHaveBeenCalled();
});

it("does not let someone who makes orders verify them", async () => {
  const { caller, db } = setup({
    "orders.send": true,
    "orders.receive": false,
  });
  await expect(
    caller.markAllOrderItemsReceived({ orderId: id }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller.updateOrderItemVerification({
      orderItemId: id,
      receivedQuantity: 1,
      verificationStatus: "complete",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller.updateOrderNotes({ orderId: id, notes: "Received" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(db.transaction).not.toHaveBeenCalled();
  expect(db.select).not.toHaveBeenCalled();
  expect(db.update).not.toHaveBeenCalled();
});

it("does not let verification permission create a supplier order", async () => {
  const { caller, db } = setup({
    "orders.send": false,
    "orders.receive": true,
  });
  for (const row of [
    { id, kind: "materials", jobId: id, quoteId: otherId },
    { kind: "supplier" },
  ]) {
    const query = Object.assign(Promise.resolve([row]), {
      from: () => query,
      where: () => query,
      limit: () => query,
    });
    db.select.mockReturnValueOnce(query);
  }
  await expect(
    caller.sendGeneratedOrder({
      materialListId: id,
      supplierId: otherId,
      sentTo: "supplier@example.test",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(db.transaction).not.toHaveBeenCalled();
  expect(db.update).not.toHaveBeenCalled();
});
