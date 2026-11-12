import { expect, it } from "vitest";
import { initialReview } from "./receiving-review";
import { receivingReviewComplete } from "./receiving-completion";
function posted() {
  const review = initialReview(undefined, "version", "user");
  review.kindConfirmed = true;
  review.orderConfirmed = true;
  review.documentChecked = false;
  review.lines = [{id:"line",page:1,evidence:"Valve 2",description:"Valve",sku:"",unit:"ea",quantity:2,ordered:2,unitPrice:null,orderItemId:"item",issues:[],checked:true,approved:{itemId:"item",quantity:2,kind:"delivery",by:"user",at:"now"}}];
  return review;
}
it("uses matching posted receipts even with an unset document flag", () => {
  expect(receivingReviewComplete(posted(), "version")).toBe(true);
});
it.each(["quantity", "item", "kind", "unapproved", "version", "order", "kindConfirmed", "cancel-requested", "unchecked", "trial"])("keeps %s changes in review", change => {
  const review = posted();
  const line = review.lines[0]!;
  if (change === "quantity") line.quantity = 3;
  if (change === "item") line.orderItemId = "another";
  if (change === "kind") line.kind = "return-credit";
  if (change === "unapproved") delete line.approved;
  if (change === "version") review.versionId = "old";
  if (change === "order") review.orderConfirmed = false;
  if (change === "kindConfirmed") review.kindConfirmed = false;
  if (change === "cancel-requested") review.orderResolutions = { item: {disposition:"cancel-requested",note:"cancel",by:"user",at:"now"} };
  if (change === "unchecked") line.checked = false;
  if (change === "trial") { review.sourceTrial = {runId:"trial",reader:"terra"}; line.checked = false; }
  expect(receivingReviewComplete(review, "version")).toBe(false);
});
it("does not infer completion for an empty or entirely excluded slip", () => {
  const review = posted();
  review.lines = [];
  expect(receivingReviewComplete(review, "version")).toBe(false);
  review.lines = posted().lines;
  review.lines[0]!.ignored = {reason:"Not an item",by:"user",at:"now"};
  expect(receivingReviewComplete(review, "version")).toBe(false);
});

it("preserves older posted receipts without an explicit checked field", () => {
  const review = posted();
  delete review.lines[0]!.checked;
  expect(receivingReviewComplete(review, "version")).toBe(true);
});

it.each(["unresolved", "outstanding", "backordered"] as const)("does not hold a slip open for an order item left off it (%s)", disposition => {
  const review = posted();
  review.orderResolutions = { other: {disposition,note:"",by:"user",at:"now"} };
  expect(receivingReviewComplete(review, "version")).toBe(true);
});

it("completes a slip whose accepted line came short of the order", () => {
  const review = posted();
  const line = review.lines[0]!;
  line.ordered = 10;
  expect(receivingReviewComplete(review, "version")).toBe(true);
});
