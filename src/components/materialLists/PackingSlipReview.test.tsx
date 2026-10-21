import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PackingSlipReview } from "./PackingSlipReview";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
afterEach(cleanup);
const analysis: SlipAnalysis = {
  runId: "r",
  versionId: "v",
  status: "ready",
  startedAt: "2026-10-17",
  items: [
    {
      id: "a",
      description: "Valve",
      sku: "123",
      aliases: [],
      ordered: 10,
      received: 2,
      verificationStatus: "partial",
      unit: "ea",
      piecesPerPack: null,
      individualUnit: null,
    },
  ],
  warnings: [],
  lines: [
    {
      page: 1,
      evidence: "123 Valve 10 6 4 ea",
      orderItemId: "a",
      shipped: 6,
      backordered: 4,
      unit: "ea",
      proposed: 6,
      issues: ["4 ea backordered."],
    },
  ],
};
it("prefills this delivery, requires physical confirmation, and sends corrected delta only", async () => {
  const action = vi.fn(async () => {});
  render(
    <PackingSlipReview
      analysis={analysis}
      versionId="v"
      busy={false}
      onAction={action}
    />,
  );
  expect(screen.getByLabelText("Received this delivery: Valve")).toHaveValue(6);
  expect(screen.getByText("New received total: 8 ea")).toBeInTheDocument();
  const submit = screen.getByText("Confirm received quantities");
  expect(submit).toBeDisabled();
  expect(action).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Received this delivery: Valve"), {
    target: { value: "5" },
  });
  expect(screen.getByText(/Actual receipt differs/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(submit);
  await waitFor(() => expect(action).toHaveBeenCalledWith("confirm", { a: 5 }));
});
it("shows confirmation without allowing a second application", () => {
  render(
    <PackingSlipReview
      analysis={{
        ...analysis,
        applied: { at: "2026-10-17", by: "u", quantities: { a: 6 } },
      }}
      versionId="v"
      busy={false}
      onAction={vi.fn()}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "will not be counted again",
  );
  expect(
    screen.queryByText("Confirm received quantities"),
  ).not.toBeInTheDocument();
});
const pipe = {
  ...analysis.items[0]!,
  id: "b",
  description: "Pipe",
  sku: null,
  ordered: 3,
  received: 0,
  unit: "ea",
};
const withExtra: SlipAnalysis = {
  ...analysis,
  items: [...analysis.items, pipe],
  lines: [
    analysis.lines[0]!,
    {
      page: 1,
      evidence: "PEX PIPE 3 EA",
      orderItemId: null,
      shipped: 3,
      backordered: null,
      unit: "ea",
      proposed: null,
      quantityClear: true,
      candidates: ["b"],
      issues: ["Not on this order, or the product could not be identified."],
    },
  ],
};
it("links an unmatched slip line to an order item and sends the link", async () => {
  const action = vi.fn(async () => {});
  render(
    <PackingSlipReview
      analysis={withExtra}
      versionId="v"
      busy={false}
      onAction={action}
    />,
  );
  expect(screen.getByLabelText("Received this delivery: Pipe")).toHaveValue(
    null,
  );
  expect(
    screen.getByText(/On the slip but not matched \(1\)/),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Order item for slip line 2"), {
    target: { value: "b" },
  });
  expect(screen.getByLabelText("Received this delivery: Pipe")).toHaveValue(3);
  expect(
    screen.queryByText(/On the slip but not matched/),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/matched by you/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByText("Confirm received quantities"));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith("confirm", { a: 6, b: 3 }, { 1: "b" }),
  );
});
it("filters order items by delivery status", () => {
  render(
    <PackingSlipReview
      analysis={withExtra}
      versionId="v"
      busy={false}
      onAction={vi.fn()}
    />,
  );
  expect(screen.getByText("2 ea outstanding")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Not on slip/ }));
  expect(
    screen.getByLabelText("Received this delivery: Pipe"),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText("Received this delivery: Valve"),
  ).not.toBeInTheDocument();
});
