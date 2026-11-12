import { expect, it } from "vitest";
import type { ReceiptOrderItem } from "./packing-slip-review";
import { initialReview } from "./receiving-review";
import { receivingProgress } from "./receiving-progress";
import {
  newResolution,
  resolutionCounterpartFingerprint,
} from "./receiving-resolution";

const item = (id: string): ReceiptOrderItem => ({
  id,
  description: "Valve",
  sku: "V",
  aliases: [],
  ordered: 10,
  received: 0,
  verificationStatus: "pending",
  unit: "ea",
  piecesPerPack: null,
  individualUnit: null,
});
function review() {
  const r = initialReview(undefined, "version", "user");
  r.kindConfirmed = true;
  r.orderConfirmed = true;
  r.lines = [
    {
      id: "line",
      page: 1,
      evidence: "Valve 6",
      description: "Valve",
      sku: "V",
      unit: "ea",
      quantity: 6,
      ordered: 10,
      unitPrice: null,
      orderItemId: "a",
      issues: ["Short"],
      checked: true,
    },
  ];
  return r;
}

it("counts a short line confirmed as read as ready, not as still to check", () => {
  const r = review();
  const line = r.lines[0]!;
  line.resolution = {
    ...newResolution(line, "user", "now"),
    counterpartFingerprint: resolutionCounterpartFingerprint(item("a")),
    match: "confirmed",
    specification: "confirmed",
    quantity: "confirmed",
    delivery: "confirmed",
    siteQuantity: 6,
    acceptedQuantity: 6,
    note: "Reviewer confirmed the displayed information is correct.",
  };
  const progress = receivingProgress(r, [item("a"), item("b")]);
  expect(progress.ready.map((l) => l.id)).toEqual(["line"]);
  expect(progress.toReview).toBe(0);
});

it("does not count an order item left off the slip, only a requested cancellation", () => {
  const r = review();
  r.orderResolutions = {
    b: { disposition: "unresolved", note: "", by: "user", at: "now" },
  };
  expect(receivingProgress(r, [item("a"), item("b")]).toReview).toBe(0);
  r.orderResolutions.b = {
    disposition: "cancel-requested",
    note: "Not needed",
    by: "user",
    at: "now",
  };
  expect(receivingProgress(r, [item("a"), item("b")]).toReview).toBe(1);
});
