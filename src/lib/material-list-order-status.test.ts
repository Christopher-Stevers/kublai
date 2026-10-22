import { expect, it } from "vitest";
import { materialListOrderStatuses } from "./material-list-order-status";
it("requires every item complete, excludes cancelled/other lists, and handles empty orders", () => {
  const orders = ["full", "partial", "empty", "cancelled", "other"].map(
    (id, i) => ({
      id,
      materialListId: id === "other" ? "other" : "list",
      orderNumber: `ORDER-${i}`,
      status: id === "cancelled" ? "cancelled" : "sent",
    }),
  );
  const counts = new Map([
    ["full", { itemCount: 2, completeItemCount: 2 }],
    ["partial", { itemCount: 2, completeItemCount: 1 }],
    ["empty", { itemCount: 0, completeItemCount: 0 }],
  ]);
  expect(
    materialListOrderStatuses("list", orders, counts).map((x) => [
      x.id,
      x.complete,
    ]),
  ).toEqual([
    ["full", true],
    ["partial", false],
    ["empty", false],
  ]);
});
it("weights deliveries by quantity rather than number of rows", () => {
  const rows = [
    { id: "a", materialListId: "l", orderNumber: "ORDER-1", status: "sent" },
  ];
  const counts = new Map([
    [
      "a",
      {
        itemCount: 2,
        completeItemCount: 0,
        orderedQuantity: 100,
        receivedQuantity: 25,
      },
    ],
  ]);
  expect(
    materialListOrderStatuses("l", rows, counts)[0]?.deliveredPercent,
  ).toBe(25);
});
