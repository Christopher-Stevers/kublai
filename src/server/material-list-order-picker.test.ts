// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/api/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { createTRPCRouter: t.router, hasDashboardAccess: t.procedure };
});
import { materialListRouter } from "~/server/api/routers/materialList";
import { orders } from "~/server/db/schema";
it("selects and returns the recorded sent timestamp separately from creation", async () => {
  const createdAt = new Date("2026-10-20T12:00:00Z"),
    sentAt = new Date("2026-10-21T19:41:00Z");
  const selections: Record<string, unknown>[] = [];
  const rows = [
    [{ id: "list", jobId: "job" }],
    [
      {
        id: "order",
        orderNumber: "166-Fastening House",
        status: "sent",
        createdAt,
        sentAt,
        supplierId: "supplier",
        supplierName: "Fastening House",
        priceBookName: "Alma",
      },
    ],
  ];
  const db = {
    select: (fields: Record<string, unknown>) => {
      selections.push(fields);
      const query = Object.assign(Promise.resolve(rows.shift()), {
        from: () => query,
        leftJoin: () => query,
        where: () => query,
        limit: () => query,
        orderBy: () => query,
      });
      return query;
    },
  };
  const caller = materialListRouter.createCaller({
    db,
    user: { organizationId: "org" },
  } as never);
  const result = await caller.getOrdersForMaterialList({
    materialListId: "00000000-0000-4000-8000-000000000001",
  });
  expect(selections[1]?.sentAt).toBe(orders.sentAt);
  expect(result[0]).toMatchObject({ createdAt, sentAt });
  expect(result[0]?.sentAt).not.toEqual(result[0]?.createdAt);
});
