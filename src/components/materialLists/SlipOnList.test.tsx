import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { confirmAction, notify } from "~/components/ui/app-dialogs";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
import { SlipBadge, SlipPartSheet, SlipVerifyBar } from "./SlipOnList";
import { useSlipDraft } from "./use-slip-draft";
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
  const draft = useSlipDraft({
    jobId: "j",
    materialListId: "m",
    orderId: "o",
    enabled: true,
    onConfirmed,
  });
  const [open, setOpen] = useState<string | null>(null);
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

it("fills the parts in from the slip and confirms the delivery in one go", async () => {
  const posts = serve(analysis);
  render(<List />);
  await screen.findByText("Packing slip read");
  expect(card("a")).toHaveTextContent("Slip +6");
  expect(card("a")).toHaveTextContent("total 8");
  expect(card("b")).toHaveTextContent("Not on slip");
  expect(
    screen.getByText(/1 part filled in from the slip/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Confirm delivery/ }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "confirm",
    documentId: "doc",
    runId: "r",
    quantities: { a: 6 },
  });
  expect(posts[0]!.links).toBeUndefined();
  await waitFor(() =>
    expect(screen.queryByText("Packing slip read")).not.toBeInTheDocument(),
  );
  expect(notify).toHaveBeenCalledWith(
    "Delivery confirmed. Received quantities updated.",
    "success",
  );
});

it("links an unmatched slip line to a part from the bar", async () => {
  const posts = serve(analysis);
  render(<List />);
  await screen.findByText(/1 slip line not matched to a part/);
  fireEvent.change(screen.getByLabelText("Order item for slip line 2"), {
    target: { value: "b" },
  });
  expect(card("b")).toHaveTextContent("Slip +3");
  expect(screen.queryByText(/not matched to a part/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Confirm delivery/ }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    quantities: { a: 6, b: 3 },
    links: { 1: "b" },
  });
});

it("asks for a check on unclear lines and takes a corrected count from the part", async () => {
  const posts = serve({
    ...analysis,
    lines: [
      {
        ...analysis.lines[0]!,
        proposed: null,
        quantityClear: false,
        handwritten: 5,
        issues: [
          "Handwriting on this line may change the quantity. Check the slip.",
        ],
      },
    ],
  });
  render(<List />);
  await screen.findByText("Packing slip read");
  expect(card("a")).toHaveTextContent("Check");
  expect(screen.getByText(/1 to check/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Confirm delivery/ }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: /Packing slip for Valve/ }),
  );
  const input = await screen.findByLabelText("Arrived in this delivery: Valve");
  expect(input).toHaveValue(null);
  fireEvent.click(screen.getByRole("button", { name: "Use handwritten 5" }));
  expect(input).toHaveValue(5);
  expect(
    screen.getByText(/Received total becomes 7 ea of 10 ea/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Done/ }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(card("a")).not.toHaveTextContent("Check");
  expect(card("a")).toHaveTextContent("total 7");
  fireEvent.click(screen.getByRole("button", { name: /Confirm delivery/ }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ quantities: { a: 5 } });
});

it("keeps changes made on a part card and its problem mark", async () => {
  const posts = serve(analysis);
  const confirmed = vi.fn();
  render(<List onConfirmed={confirmed} />);
  await screen.findByText("Packing slip read");
  fireEvent.click(screen.getByRole("button", { name: "Card Valve" }));
  expect(card("a")).toHaveTextContent("total 10");
  fireEvent.click(screen.getByRole("button", { name: /Confirm delivery/ }));
  await waitFor(() => expect(confirmed).toHaveBeenCalledWith({ a: 10 }));
  expect(posts[0]).toMatchObject({ quantities: { a: 8 } });
});

it("does nothing when the member backs out of confirming", async () => {
  const posts = serve(analysis);
  vi.mocked(confirmAction).mockResolvedValueOnce(false);
  render(<List />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Confirm delivery/ }),
  );
  await waitFor(() => expect(confirmAction).toHaveBeenCalled());
  expect(posts).toHaveLength(0);
});

it("offers Refresh totals when the order changed since the slip was read", async () => {
  const posts = serve(
    analysis,
    "This order or its received quantities changed. Refresh totals and check this delivery again.",
  );
  render(<List />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Confirm delivery/ }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Refresh totals" }),
  );
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]).toMatchObject({ action: "refresh", runId: "r" });
});
