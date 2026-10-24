import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PackingSlipReview } from "./PackingSlipReview";
import { confirmAction } from "~/components/ui/app-dialogs";
vi.mock("~/components/ui/app-dialogs", () => ({ confirmAction: vi.fn() }));
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
it("summarises a read slip and sends the member to the list to check it", () => {
  const onShowList = vi.fn();
  render(
    <PackingSlipReview
      analysis={analysis}
      versionId="v"
      busy={false}
      onAction={vi.fn()}
      onShowList={onShowList}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Read and filled in on the list",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "1 part from the slip · 1 to check",
  );
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /Check parts on the list/ }),
  );
  expect(onShowList).toHaveBeenCalledTimes(1);
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
  expect(screen.getByRole("status")).toHaveTextContent("Receipt confirmed");
  expect(screen.getByRole("status")).toHaveTextContent("1 item received");
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
it("counts slip lines that were not matched to a part", () => {
  render(
    <PackingSlipReview
      analysis={withExtra}
      versionId="v"
      busy={false}
      onAction={vi.fn()}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "1 slip line not matched",
  );
});

it("asks before a confirmed slip's receipt is taken back by clearing or rerunning", async () => {
  const action = vi.fn().mockResolvedValue(undefined);
  const ask = vi.mocked(confirmAction);
  render(
    <PackingSlipReview
      analysis={{
        ...analysis,
        applied: { at: "2026-10-17", by: "u", quantities: { a: 6 } },
      }}
      versionId="v"
      busy={false}
      onAction={action}
    />,
  );
  ask.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "Clear detection" }));
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  expect(ask.mock.calls[0]![0].description).toContain(
    "takes back the received quantities this slip confirmed for 1 item",
  );
  expect(action).not.toHaveBeenCalled();
  ask.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "Clear detection" }));
  await waitFor(() => expect(action).toHaveBeenLastCalledWith("clear"));
  ask.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "Rerun detection" }));
  await waitFor(() => expect(action).toHaveBeenLastCalledWith("analyze"));
  expect(ask.mock.calls[2]![0].title).toBe("Read this slip again?");
  expect(screen.queryByText("Confirm received quantities")).toBeNull();
  ask.mockReset();
});
it("reruns an unconfirmed slip without asking", async () => {
  const action = vi.fn().mockResolvedValue(undefined);
  render(
    <PackingSlipReview
      analysis={analysis}
      versionId="v"
      busy={false}
      onAction={action}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Rerun detection" }));
  await waitFor(() => expect(action).toHaveBeenLastCalledWith("analyze"));
  expect(confirmAction).not.toHaveBeenCalled();
});
it("shows only the confirmed receipt for slips confirmed before a rerun", () => {
  const applied = { at: "2026-10-17", by: "u", quantities: { a: 6 } };
  const view = render(
    <PackingSlipReview
      analysis={{
        ...analysis,
        status: "cleared",
        items: [],
        lines: [],
        confirmedItems: analysis.items,
        applied,
      }}
      versionId="v"
      busy={false}
      onAction={vi.fn()}
    />,
  );
  expect(screen.getByText("Receipt confirmed")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Clear detection" }),
  ).toBeInTheDocument();
  view.rerender(
    <PackingSlipReview
      analysis={{ ...analysis, confirmedItems: analysis.items, applied }}
      versionId="v"
      busy={false}
      onAction={vi.fn()}
    />,
  );
  expect(screen.getByText("Valve")).toBeInTheDocument();
  expect(screen.getByText("6 ea")).toBeInTheDocument();
  expect(screen.queryByText(/Comparison only/)).toBeNull();
  expect(screen.queryByText("Confirm received quantities")).toBeNull();
});
it("disables detection actions while saving and hides them from read-only viewers", () => {
  const props = {
    analysis: {
      ...analysis,
      applied: { at: "2026-10-17", by: "u", quantities: { a: 6 } },
    },
    versionId: "v",
    onAction: vi.fn(),
  };
  const view = render(<PackingSlipReview {...props} busy />);
  expect(
    screen.getByRole("button", { name: "Clear detection" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Rerun detection" }),
  ).toBeDisabled();
  view.rerender(
    <PackingSlipReview {...props} busy={false} canManage={false} />,
  );
  expect(screen.queryByRole("button", { name: "Clear detection" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Rerun detection" })).toBeNull();
});
