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
it("uses the send state independently of delivery quantities and requires all lines verified", () => {
  const orders = [
    {id:"draft",materialListId:"l",orderNumber:"ORDER-1",status:"draft"},
    {id:"sent",materialListId:"l",orderNumber:"ORDER-2",status:"sent"},
    {id:"verified",materialListId:"l",orderNumber:"ORDER-3",status:"received"},
  ];
  const verification = new Map(orders.map(order => [order.id,{itemCount:2,completeItemCount:order.id==="sent"?1:2,orderedQuantity:2,receivedQuantity:2}]));
  expect(materialListOrderStatuses("l",orders,verification).map(order=>order.state)).toEqual(["potential","sent","verified"]);
});
it("groups unsent lines by supplier alongside sent orders, and replaces cancelled links with potential orders", () => {
  const orders=[{id:"sent",materialListId:"l",orderNumber:"ORDER-1",status:"sent",supplierId:"supplier"},{id:"cancelled",materialListId:"l",orderNumber:"ORDER-2",status:"cancelled"}];
  const rows=[{supplierId:"supplier",supplierName:"Supplier",sentOrderId:"sent"},{supplierId:"supplier",supplierName:"Supplier"},{supplierId:"supplier",supplierName:"Supplier"},{supplierId:"second",supplierName:"Second",sentOrderId:"cancelled"},{supplierId:null}];
  expect(materialListOrderStatuses("l",orders,new Map(),rows).map(order=>[order.number,order.state])).toEqual([["Supplier","potential"],["Second","potential"],["ORDER-1","sent"]]);
});
it("does not duplicate a draft order or Tool Room draft with potential tags", () => {
  const orders=[{id:"draft",materialListId:"l",orderNumber:"ORDER-1",status:"draft",supplierId:"supplier"}];
  expect(materialListOrderStatuses("l",orders,new Map(),[{supplierId:"supplier"}])).toHaveLength(1);
  expect(materialListOrderStatuses("l",orders,new Map(),[{supplierId:"tool-room",supplierName:"Tool Room"}])).toHaveLength(1);
});
