import { expect, it } from "vitest";
import type { ReceiptOrderItem } from "./packing-slip-review";
import type { ReceivingLine, ReceivingReview } from "./receiving-review";
import type { ReceivingResolution } from "./receiving-resolution";
import { supplierClaim } from "./supplier-claim";

const item = (
  id: string,
  over: Partial<ReceiptOrderItem> = {},
): ReceiptOrderItem => ({
  id,
  description: `Valve ${id}`,
  sku: `V-${id}`,
  aliases: [],
  ordered: 10,
  received: 0,
  verificationStatus: "pending",
  unit: "ea",
  piecesPerPack: null,
  individualUnit: null,
  ...over,
});
const resolution = (
  over: Partial<ReceivingResolution> = {},
): ReceivingResolution => ({
  evidenceFingerprint: "",
  match: "confirmed",
  specification: "confirmed",
  quantity: "confirmed",
  delivery: "confirmed",
  note: "",
  by: "u",
  at: "now",
  ...over,
});
const line = (
  id: string,
  over: Partial<ReceivingLine> = {},
  r?: Partial<ReceivingResolution>,
): ReceivingLine => ({
  id: `l-${id}`,
  page: 1,
  evidence: "",
  description: `slip ${id}`,
  sku: "",
  unit: "ea",
  quantity: 10,
  ordered: 10,
  unitPrice: null,
  orderItemId: id,
  issues: [],
  resolution: r && resolution(r),
  ...over,
});
const review = (
  lines: ReceivingLine[],
  over: Partial<ReceivingReview> = {},
): ReceivingReview => ({
  revision: 1,
  versionId: "v",
  kind: "delivery",
  kindConfirmed: true,
  supplierName: "Wolseley",
  supplierId: null,
  deliveryNumber: "4471",
  supplierOrderNumber: "",
  deliveryDate: "",
  lines,
  warnings: [],
  preparedAt: "now",
  preparedBy: "u",
  ...over,
});

it("writes nothing when every line arrived as ordered", () => {
  expect(
    supplierClaim({
      review: review([line("a", {}, {})]),
      items: [item("a")],
      orderNumber: "PO-155",
    }),
  ).toBeNull();
  expect(
    supplierClaim({
      review: review([line("a")]),
      items: [item("a")],
      orderNumber: "PO-155",
    }),
  ).toBeNull();
});

it("lists short and damaged lines with the slip and site counts", () => {
  const claim = supplierClaim({
    review: review([
      line(
        "a",
        {},
        {
          delivery: "short",
          siteQuantity: 7,
          remainder: "backordered",
          note: "Driver said the rest is on the truck",
        },
      ),
      line(
        "b",
        { unit: "ft", quantity: 20 },
        { delivery: "damaged", siteQuantity: 20, acceptedQuantity: 16 },
      ),
    ]),
    items: [item("a"), item("b", { ordered: 20, unit: "ft" })],
    orderNumber: "PO-155",
  })!;
  expect(claim.subject).toBe("Delivery issue: PO-155, packing slip 4471");
  expect(claim.problems).toBe(true);
  expect(claim.body).toContain("Hi Wolseley,");
  expect(claim.body).toContain(
    "We received packing slip 4471 for PO-155. Some items need your attention.",
  );
  expect(claim.body).toContain(
    "Short\n- Valve a (V-a): the slip shows 10, 7 arrived. Short 3.\n  Note: Driver said the rest is on the truck",
  );
  expect(claim.body).toContain(
    "Damaged\n- Valve b (V-b): 20 ft arrived, 4 ft damaged.",
  );
  expect(claim.body).toContain(
    "Still to come\n- Valve a (V-a): 3 backordered.",
  );
  expect(claim.body).toContain(
    "Please send replacements or a credit for the short, damaged or wrong items.",
  );
  expect(claim.body).toContain(
    "Please confirm when the remaining items will ship.",
  );
  expect(claim.count).toBe(3);
});

it("says whether a wrong item was kept or refused", () => {
  const body = supplierClaim({
    review: review([
      line(
        "a",
        {},
        {
          delivery: "wrong",
          specification: "substitution-rejected",
          siteQuantity: 10,
          acceptedQuantity: 0,
        },
      ),
      line(
        "b",
        {},
        {
          delivery: "wrong",
          specification: "substitution-accepted",
          siteQuantity: 10,
        },
      ),
      line("c", {}, { materialIssue: "supplier-return" }),
      line("d", {}, { materialIssue: "supplier-keep" }),
    ]),
    items: ["a", "b", "c", "d"].map((id) => item(id)),
  })!.body;
  expect(body).toContain(
    "- Valve a (V-a): the wrong item was sent. We did not accept it.",
  );
  expect(body).toContain(
    "- Valve b (V-b): the wrong item was sent. We are keeping it.",
  );
  expect(body).toContain(
    "- Valve c (V-c): the wrong item was sent. It needs to be returned.",
  );
  expect(body).not.toContain("Valve d");
  expect(body).toContain("for our order.");
});

it("does not ask for replacements for a substitute that was kept", () => {
  const claim = supplierClaim({
    review: review([
      line(
        "a",
        {},
        {
          delivery: "wrong",
          specification: "substitution-accepted",
          siteQuantity: 10,
        },
      ),
    ]),
    items: [item("a")],
  })!;
  expect(claim.body).not.toContain("replacements");
});

it("asks to collect excess being returned and to cancel what is not wanted", () => {
  const body = supplierClaim({
    review: review([
      line(
        "a",
        { quantity: 12 },
        { siteQuantity: 12, acceptedQuantity: 10, excess: "return" },
      ),
      line("b", { quantity: 6 }, { remainder: "cancelled" }),
    ]),
    items: [item("a"), item("b")],
    orderNumber: "PO-9",
  })!.body;
  expect(body).toContain(
    "Sent more than ordered, to be returned\n- Valve a (V-a): 2 more than ordered was sent. We are returning it.",
  );
  expect(body).toContain("Please cancel\n- Valve b (V-b): the remaining 4.");
  expect(body).toContain("Please arrange to collect what we are returning.");
  expect(body).toContain("Please cancel the items listed and confirm.");
});

it("asks about a remainder nobody explained and counts approved lines once", () => {
  const body = supplierClaim({
    review: review([
      line(
        "a",
        {
          quantity: 4,
          approved: {
            quantity: 4,
            itemId: "a",
            kind: "delivery",
            by: "u",
            at: "now",
          },
        },
        { remainder: "unexplained" },
      ),
    ]),
    items: [item("a", { received: 4 })],
  })!.body;
  expect(body).toContain(
    "Shipped less than ordered, not marked as backordered\n- Valve a (V-a): 10 ordered, 4 on this slip. Please confirm the remaining 6.",
  );
});

it("includes order items left off the slip as the reviewer decided them", () => {
  const claim = supplierClaim({
    review: review([line("a")], {
      orderResolutions: {
        b: { disposition: "backordered", note: "", by: "u", at: "now" },
        c: { disposition: "cancel-requested", note: "", by: "u", at: "now" },
        d: { disposition: "outstanding", note: "", by: "u", at: "now" },
        e: { disposition: "unresolved", note: "", by: "u", at: "now" },
      },
    }),
    items: ["a", "b", "c", "d", "e"].map((id) => item(id)),
    orderNumber: "PO-155",
  })!;
  expect(claim.subject).toBe("Items still due: PO-155, packing slip 4471");
  expect(claim.problems).toBe(false);
  expect(claim.body).toContain("Some items are still to come.");
  expect(claim.body).toContain("- Valve b (V-b): 10 backordered.");
  expect(claim.body).toContain("- Valve d (V-d): 10 not on this delivery.");
  expect(claim.body).toContain(
    "Please cancel\n- Valve c (V-c): the 10 not delivered.",
  );
  expect(claim.body).not.toContain("Valve e");
});

it("leaves out ignored lines, credits and decisions with nothing left due", () => {
  expect(
    supplierClaim({
      review: review(
        [
          line(
            "a",
            { ignored: { reason: "dup", by: "u", at: "now" } },
            { delivery: "short", siteQuantity: 1 },
          ),
          line(
            "b",
            { kind: "credit-only" },
            { delivery: "short", siteQuantity: 1 },
          ),
          line("c", {}, { remainder: "backordered" }),
        ],
        {
          orderResolutions: {
            d: { disposition: "backordered", note: "", by: "u", at: "now" },
          },
        },
      ),
      items: [item("a"), item("b"), item("c"), item("d", { received: 10 })],
    }),
  ).toBeNull();
});

it("names a delivery without a slip number plainly", () => {
  const claim = supplierClaim({
    review: review([line("a", {}, { delivery: "short", siteQuantity: 8 })], {
      deliveryNumber: "",
      supplierName: "",
    }),
    items: [item("a")],
    orderNumber: "PO-1",
  })!;
  expect(claim.subject).toBe("Delivery issue: PO-1");
  expect(
    claim.body.startsWith("Hi there,\n\nWe received a delivery for PO-1."),
  ).toBe(true);
});
