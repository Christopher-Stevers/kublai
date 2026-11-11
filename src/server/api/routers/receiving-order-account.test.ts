// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/simulation/service", () => ({
  recordSimulationAction: vi.fn(async () => null),
}));
import { materialListRouter } from "./materialList";
import { liveAccountScope } from "~/lib/live-protocol";
import type { createTRPCContext } from "~/server/api/trpc";
const org = "11111111-1111-4111-8111-111111111111",
  orderId = "22222222-2222-4222-8222-222222222222",
  jobId = "33333333-3333-4333-8333-333333333333";
const database = { select: vi.fn(), transaction: vi.fn(), execute: vi.fn() };
type RowsQuery = {
  from: () => RowsQuery;
  leftJoin: () => RowsQuery;
  where: () => RowsQuery;
  limit: () => Promise<unknown[]>;
  then: (resolve: (value: unknown[]) => unknown) => Promise<unknown>;
};
function queryRows(rows: unknown[]) {
  const query: RowsQuery = {
    from: () => query,
    leftJoin: () => query,
    where: () => query,
    limit: async () => rows,
    then: (resolve: (value: unknown[]) => unknown) =>
      Promise.resolve(rows).then(resolve),
  };
  return query;
}
function caller(
  userId = "reader",
  organizationId: string | null = org,
  simulation: { id: string } | null = null,
  status = "approved",
) {
  return materialListRouter.createCaller({
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
  database.select.mockImplementation(() => queryRows([]));
});
function orderResponse() {
  database.select
    .mockReturnValueOnce(
      queryRows([
        {
          id: orderId,
          jobId,
          materialListId: "list",
          orderNumber: "PO-1",
          status: "sent",
          notes: null,
          createdAt: new Date(),
          sentAt: null,
          supplierId: null,
        },
      ]),
    )
    .mockReturnValueOnce(queryRows([]));
}
it("returns real job identity for matching account and preserves legacy omission", async () => {
  orderResponse();
  expect(
    await caller().getOrderById({
      orderId,
      expectedAccountKey: liveAccountScope(org, "reader"),
    }),
  ).toMatchObject({ id: orderId, jobId });
  orderResponse();
  expect(await caller().getOrderById({ orderId })).toMatchObject({
    id: orderId,
    jobId,
  });
  expect(database.select).toHaveBeenCalledTimes(4);
});
it("accepts the full matching simulation identity", async () => {
  orderResponse();
  expect(
    await caller("reader", org, { id: "one" }).getOrderById({
      orderId,
      expectedAccountKey: liveAccountScope(org, "reader", "one"),
    }),
  ).toMatchObject({ id: orderId, jobId });
});
for (const [label, user, organization, simulation, expected] of [
  ["user", "other", org, null, liveAccountScope(org, "reader")],
  ["organization", "reader", jobId, null, liveAccountScope(org, "reader")],
  [
    "direct to simulation",
    "reader",
    org,
    { id: "one" },
    liveAccountScope(org, "reader"),
  ],
  [
    "simulation to direct",
    "reader",
    org,
    null,
    liveAccountScope(org, "reader", "one"),
  ],
  [
    "simulation replacement",
    "reader",
    org,
    { id: "two" },
    liveAccountScope(org, "reader", "one"),
  ],
] as const)
  it(`rejects stale ${label} before DB work`, async () => {
    await expect(
      caller(user, organization, simulation).getOrderById({
        orderId,
        expectedAccountKey: expected,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    for (const method of Object.values(database))
      expect(method).not.toHaveBeenCalled();
  });
it("preserves app-access refusal and bounds the optional guard", async () => {
  await expect(
    caller("reader", null).getOrderById({ orderId }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller("reader", org, null, "pending").getOrderById({ orderId }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller().getOrderById({ orderId, expectedAccountKey: "x".repeat(513) }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(database.select).not.toHaveBeenCalled();
});
