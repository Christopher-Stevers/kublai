// @vitest-environment node
import { expect, it } from "vitest";
import { initialReview } from "~/lib/receiving-review";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
import { mergeReading } from "./review-draft";
const reading = (q: number): SlipAnalysis => ({
  runId: `run-${q}`,
  versionId: "v",
  status: "ready",
  startedAt: "now",
  items: [],
  warnings: [],
  lines: [
    {
      page: 1,
      evidence: "Valve source row",
      box: { x: 0, y: 0.4, width: 1, height: 0.02 },
      description: "Valve",
      orderItemId: "item",
      shipped: q,
      backordered: 0,
      unit: "ea",
      proposed: q,
      issues: [],
    },
  ],
});
it("refreshes untouched predictions while keeping a confirmed document identity", () => {
  const old = initialReview(reading(3), "v", "member");
  old.humanReviewed = true;
  old.deliveryNumber = "SLIP-77";
  old.kind = "return-credit";
  const next = mergeReading(old, initialReview(reading(4), "v", "member"));
  expect(next.deliveryNumber).toBe("SLIP-77");
  expect(next.kind).toBe("return-credit");
  expect(next.lines[0]!.quantity).toBe(4);
  expect(next.documentChecked).toBe(false);
});
it("preserves approved quantities and their source crop when a reread changes the detection", () => {
  const old = initialReview(reading(3), "v", "member");
  old.humanReviewed = true;
  old.lines[0]!.approved = {
    quantity: 3,
    kind: "delivery",
    itemId: "item",
    by: "member",
    at: "now",
  };
  const next = mergeReading(old, initialReview(reading(4), "v", "member"));
  expect(next.lines).toHaveLength(1);
  expect(next.lines[0]!.approved?.quantity).toBe(3);
  expect(next.lines[0]!.quantity).toBe(3);
  expect(next.lines[0]!.sourceBox).toEqual(reading(3).lines[0]!.box);
});
it("flags newly found rows near preserved decisions and never silently adopts a replaced source", () => {
  const old = initialReview(reading(3), "v", "member");
  old.humanReviewed = true;
  old.lines[0]!.humanEdited = true;
  const a = reading(4);
  a.lines[0]!.box!.y = 0.7;
  a.lines[0]!.evidence = "Another line on page";
  const fresh = initialReview(a, "v", "member");
  const next = mergeReading(old, fresh);
  expect(next.lines).toHaveLength(2);
  expect(next.lines[1]!.issues.join(" ")).toContain("avoid repeating");
  expect(mergeReading(old, { ...fresh, versionId: "changed" })).toBe(old);
});
