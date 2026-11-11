// @vitest-environment node
import { expect, it } from "vitest";
import type { ReceivingLine } from "~/lib/receiving-review";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
import { linkLineAction } from "./receiving-link-action";
const line: ReceivingLine = {
  id: "line",
  page: 1,
  evidence: "source",
  description: "Coupling",
  sku: "sku",
  quantity: 20,
  ordered: 30,
  unit: "pcs",
  unitPrice: 1,
  orderItemId: null,
  issues: [],
};
const item: ReceiptOrderItem = {
  id: "item",
  description: "Coupling",
  sku: "sku",
  aliases: [],
  ordered: 3,
  received: 0,
  verificationStatus: "pending",
  unit: "box",
  piecesPerPack: 10,
  individualUnit: "pcs",
};
it("converts linked quantities into the exact ordered pack unit without confirming a receipt", () => {
  expect(linkLineAction(line, item.id, [item])).toMatchObject({
    action: "line",
    lineId: "line",
    quantity: 2,
    ordered: 3,
    unit: "box",
    orderItemId: "item",
    checked: false,
  });
});
it("refuses incompatible conversions rather than inventing quantities", () => {
  expect(linkLineAction({ ...line, unit: "kg" }, item.id, [item])).toBeNull();
});
it("unlinking retains original readings and never approves them", () => {
  expect(linkLineAction(line, null, [item])).toMatchObject({
    quantity: 20,
    ordered: 30,
    unit: "pcs",
    orderItemId: null,
    checked: false,
  });
});
it("unknown quantity remains unknown after pairing", () => {
  expect(
    linkLineAction({ ...line, quantity: null }, item.id, [item]),
  ).toMatchObject({ quantity: null, unit: "box", checked: false });
});
