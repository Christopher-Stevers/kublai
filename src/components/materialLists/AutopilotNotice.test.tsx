import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { initialReview, type ReceivingReview } from "~/lib/receiving-review";
import { AutopilotNotice } from "./AutopilotNotice";

afterEach(cleanup);
const noop = vi.fn();

function received(): ReceivingReview {
  const review = initialReview(undefined, "v", "u");
  review.revision = 4;
  review.lines = [
    {
      id: "0",
      page: 1,
      evidence: "6 EA Valve",
      description: "Valve",
      sku: "",
      unit: "ea",
      quantity: 6,
      ordered: 10,
      unitPrice: null,
      orderItemId: "item",
      issues: [],
      checked: true,
      approved: {
        itemId: "item",
        quantity: 6,
        kind: "delivery",
        by: "u",
        at: "t",
      },
    },
  ];
  review.autopilot = {
    at: "t",
    requestId: "r",
    revision: 4,
    lines: 1,
    trustedAfter: 5,
    before: { supplierId: null },
  };
  return review;
}

it("says what was received without a check and offers Undo", () => {
  const undo = vi.fn();
  render(
    <AutopilotNotice review={received()} orderNumber="PO-155" onUndo={undo} />,
  );
  expect(screen.getByText("Received automatically")).toBeTruthy();
  expect(
    screen.getByText(/1 line on PO-155 went onto the order without a check/),
  ).toBeTruthy();
  expect(screen.getByText(/last 5 slips needed no corrections/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledOnce();
});

it("asks for corrections instead once the slip has changed", () => {
  const review = received();
  review.revision = 5;
  render(<AutopilotNotice review={review} onUndo={noop} />);
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(screen.getByText(/correct the lines instead of undoing/)).toBeTruthy();
});

it("tells the reviewer to check the lines after an undo, until they approve", () => {
  const review = received();
  review.autopilot!.undone = { by: "u", at: "t2" };
  const approved = review.lines[0]!.approved;
  delete review.lines[0]!.approved;
  const { rerender } = render(
    <AutopilotNotice review={review} onUndo={noop} />,
  );
  expect(screen.getByText(/automatic receipt was undone/)).toBeTruthy();
  review.lines[0]!.approved = approved;
  rerender(<AutopilotNotice review={{ ...review }} onUndo={noop} />);
  expect(screen.queryByText(/automatic receipt was undone/)).toBeNull();
});

it("shows nothing for a slip a person received", () => {
  const review = received();
  delete review.autopilot;
  const { container } = render(
    <AutopilotNotice review={review} onUndo={noop} />,
  );
  expect(container.textContent).toBe("");
});
