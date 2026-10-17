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
