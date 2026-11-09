import { receivingReviewHref } from "~/lib/receiving-navigation";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { confirmAction, notify } from "~/components/ui/app-dialogs";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
import { SlipBadge, SlipPartSheet, SlipVerifyBar } from "./SlipOnList";
import { useSlipDrafts } from "./use-slip-draft";
vi.mock("~/components/ui/app-dialogs", () => ({
  confirmAction: vi.fn(async () => true),
  notify: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(confirmAction).mockClear();
});

const valve = {
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
};
const pipe = {
  ...valve,
  id: "b",
  description: "Pipe",
  sku: null,
  ordered: 3,
  received: 0,
};
const analysis: SlipAnalysis = {
  runId: "r",
  versionId: "v",
  status: "ready",
  startedAt: "2026-10-24T10:00:00Z",
  items: [valve, pipe],
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
      quantityClear: true,
      confidence: "high",
      issues: [],
    },
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

function serve(slip: SlipAnalysis, error?: string) {
  const posts: Record<string, unknown>[] = [];
  let current = slip;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        const body = JSON.parse(options.body as string) as Record<
          string,
          unknown
        >;
        posts.push(body);
        if (error && body.action === "confirm")
          return Response.json({ error }, { status: 409 });
        if (body.action === "confirm")
          current = {
            ...current,
            applied: { at: "now", by: "u", quantities: {} },
          };
        return Response.json({ success: true });
      }
      return Response.json({
        canUpload: true,
        documents: [
          {
            id: "doc",
            name: "Packing slip - PO-1.pdf",
            createdAt: "2026-10-24",
            currentVersionId: "v",
            packingSlip: {
              orderId: "o",
              materialListId: "m",
              orderNumber: "PO-1",
            },
            packingSlipAnalysis: current,
          },
        ],
      });
    }),
  );
  return posts;
}

function List({
  onConfirmed,
}: {
  onConfirmed?: (p: Record<string, number>) => void;
}) {
  const drafts = useSlipDrafts({
    jobId: "j",
    materialListId: "m",
    orderId: "o",
    enabled: true,
    onConfirmed,
  });
  const [open, setOpen] = useState<string | null>(null);
  const draft = drafts.drafts[0];
  if (!draft) return null;
  return (
    <>
      <SlipVerifyBar draft={draft} jobId="j" />
      {draft.items.map((entry) => (
        <div key={entry.item.id} data-testid={`card-${entry.item.id}`}>
          <SlipBadge entry={entry} onOpen={() => setOpen(entry.item.id)} />
          <span>total {entry.total}</span>
          <button onClick={() => draft.setTotal(entry.item.id, 10, true)}>
            Card {entry.item.description}
          </button>
        </div>
      ))}
      <SlipPartSheet
        draft={draft}
        orderItemId={open}
        name={open === "a" ? "Valve" : "Pipe"}
        jobId="j"
        onClose={() => setOpen(null)}
      />
    </>
  );
}
const card = (id: string) => screen.getByTestId(`card-${id}`);

it("takes an old provisional reading to the shared queue without posting quantities", async () => {
  const posts = serve(analysis);
  render(<List />);
  await screen.findByText("Packing slip read");
  expect(
    screen.getByRole("link", { name: "Review & approve" }),
  ).toHaveAttribute("href", "/jobs/j/receiving?document=doc");
  expect(posts).toEqual([]);
  expect(confirmAction).not.toHaveBeenCalled();
});
it("keeps modern reviews in the queue and does not overlay unapproved quantities on parts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        canUpload: true,
        documents: [
          {
            id: "doc",
            name: "Slip",
            createdAt: "2026-10-27",
            currentVersionId: "v",
            packingSlip: {
              orderId: "o",
              materialListId: "m",
              orderNumber: "PO-155",
            },
            packingSlipAnalysis: analysis,
            receivingReview: { pending: 2, complete: false, retired: false },
          },
        ],
      }),
    ),
  );
  render(<List />);
  await screen.findByText("2 lines to review");
  expect(screen.queryByText("Slip +6")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Review & approve" }),
  ).toHaveAttribute("href", "/jobs/j/receiving?document=doc");
});

it("shows live provisional matches without allowing receipt confirmation", async () => {
  const posts = serve({
    ...analysis,
    status: "processing",
    lines: [],
    progress: {
      stage: "matching",
      message: "Checking each printed line…",
      completed: 1,
      total: 3,
      lines: [analysis.lines[0]!],
    },
  });
  render(<List />);
  expect(
    await screen.findByText("Checking each printed line…"),
  ).toBeInTheDocument();
  expect(screen.getByText(/1 of 3 lines checked/)).toBeInTheDocument();
  expect(
    screen.getByText(/Matched · final checks pending/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Confirm delivery/ }),
  ).not.toBeInTheDocument();
  expect(posts).toHaveLength(0);
});
it("keeps failed analysis visible on the receiving list", async () => {
  serve({
    ...analysis,
    status: "failed",
    error: "The image could not be read.",
  });
  render(<List />);
  expect(
    await screen.findByText("The image could not be read."),
  ).toBeInTheDocument();
  expect(screen.getByText(/Open Packing slips to rerun/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Confirm delivery/ }),
  ).not.toBeInTheDocument();
});

it("flags uncertain matches even when a quantity was proposed", async () => {
  serve({
    ...analysis,
    lines: [{ ...analysis.lines[0]!, confidence: "medium" }],
  });
  render(<List />);
  fireEvent.click(await screen.findByRole("button", { name: "Details" }));
  expect(screen.getByText(/Flagged/)).toBeInTheDocument();
  expect(
    screen.queryByText(/Checked · ready to confirm/),
  ).not.toBeInTheDocument();
});


it("keeps the material list as the review parent", () => {
  // URL encoding keeps the parent ID separate from the review document.
  expect(receivingReviewHref("j", "doc", "list-123")).toBe(
    "/jobs/j/receiving?document=doc&fromMaterialList=list-123",
  );
});
