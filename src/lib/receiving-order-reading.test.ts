import { expect, it } from "vitest";
import {
  makeReceivingOrderReading,
  isReceivingOrderReading,
  isReceivingAccountMismatch,
  RECEIVING_ACCOUNT_CHANGED_MESSAGE,
} from "./receiving-order-reading";
import {
  QUERY_PAYLOAD_BUDGET,
  RECEIVING_READING_BUDGET,
  TIER_ONE_PAYLOAD_BUDGET,
} from "./tier-one-cache-budget";
const scope = { orderId: "order", materialListId: "list", jobId: "job" };
const item = {
  id: "line",
  descriptionSnapshot: "Copper",
  supplierSkuSnapshot: "CU",
  quantity: "10",
  receivedQuantity: "7",
  creditedQuantity: "2",
  verificationStatus: "complete",
};
it("stores only a bounded explicitly partial reading, not receipt/contacts/rights", () => {
  const value = makeReceivingOrderReading(
    {
      id: "order",
      materialListId: "list",
      jobId: "job",
      orderNumber: "PO",
      supplier: { name: "Supplier" },
      items: Array.from({ length: 40 }, (_, i) => ({ ...item, id: String(i) })),
    },
    "job",
  )!;
  expect(value.totalLines).toBe(40);
  expect(value.lines).toHaveLength(32);
  expect(isReceivingOrderReading(value, scope)).toBe(true);
  expect(isReceivingOrderReading(value, { ...scope, orderId: "other" })).toBe(
    false,
  );
  expect(isReceivingOrderReading({ ...value, canReceive: true }, scope)).toBe(
    false,
  );
  for (const field of [
    "receivedQuantity",
    "creditedQuantity",
    "verificationStatus",
    "contactEmail",
    "notes",
  ])
    expect(JSON.stringify(value)).not.toContain(field);
  expect(QUERY_PAYLOAD_BUDGET + RECEIVING_READING_BUDGET).toBe(
    TIER_ONE_PAYLOAD_BUDGET,
  );
});
it("rejects oversize projection instead of silently truncating text", () => {
  expect(
    makeReceivingOrderReading(
      {
        id: "order",
        materialListId: "list",
        jobId: "job",
        orderNumber: "PO",
        supplier: null,
        items: [{ ...item, descriptionSnapshot: "x".repeat(20000) }],
      },
      "job",
    ),
  ).toBeNull();
});

it("never manufactures a job binding absent from the actual response", () => {
  const legacy = {
    id: "order",
    materialListId: "list",
    orderNumber: "PO",
    supplier: null,
    items: [item],
  };
  expect(makeReceivingOrderReading(legacy, "job")).toBeNull();
  expect(
    makeReceivingOrderReading({ ...legacy, jobId: "other" }, "job"),
  ).toBeNull();
});

it("does not interpret arbitrary conflict messages as an account mismatch", () => {
  expect(
    isReceivingAccountMismatch({
      data: { code: "CONFLICT" },
      message: "Concurrent note edit",
    }),
  ).toBe(false);
  expect(
    isReceivingAccountMismatch({
      data: { code: "CONFLICT" },
      message: RECEIVING_ACCOUNT_CHANGED_MESSAGE,
    }),
  ).toBe(true);
});
