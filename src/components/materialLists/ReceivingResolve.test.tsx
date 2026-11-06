import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ReceivingResolve, type ResolveTarget } from "./ReceivingResolve";
import type { ReceivingDetail, ReceivingAction } from "./ReceivingWorkspace";
import type { ResolveSlipSourceProps } from "./ResolveSlipSource";
import { initialReview, type ReceivingLine } from "~/lib/receiving-review";
import {
  newResolution,
  resolutionEvidenceFingerprint,
} from "~/lib/receiving-resolution";

vi.mock("./SlipLineImage", () => ({
  SlipLineImage: ({ page }: { page: number }) => (
    <div role="img" aria-label={`Original evidence page ${page}`} />
  ),
}));
vi.mock("./ResolveSlipSource", () => ({
  ResolveSlipSource: ({ onUse, initialPage }: ResolveSlipSourceProps) => (
    <button
      onClick={() =>
        onUse({
          page: initialPage ?? 1,
          box: { x: 0.1, y: 0.3, width: 0.8, height: 0.04 },
          description: "Recovered printed coupling line",
        })
      }
    >
      Use recovered line
    </button>
  ),
}));
vi.mock("./ReceivingReplaceSource", () => ({
  ReceivingReplaceSource: () => <div>Replace original source</div>,
}));
vi.mock("./ReceivingItemPreview", () => ({
  ReceivingItemPreview: () => <div>Catalogue part evidence</div>,
}));

const run = vi.fn<(action: ReceivingAction) => Promise<boolean>>();
const close = vi.fn();
const select = vi.fn();
const reload = vi.fn<() => Promise<void>>();
const addLine = vi.fn<ResolveSlipSourceProps["onUse"]>();
const correction = vi.fn((line: ReceivingLine, onDone: () => void) => (
  <button onClick={onDone}>Correct {line.description}</button>
));
let detail: ReceivingDetail;

function fixture(): ReceivingDetail {
  const line: ReceivingLine = {
    id: "line1",
    page: 1,
    sourceIndex: 0,
    sourceBox: { x: 0.1, y: 0.3, width: 0.8, height: 0.04 },
    description: '3" XFR Coupling',
    sku: "3XFRCOUP",
    evidence: "25 EA 3 inch XFR coupling",
    quantity: 25,
    ordered: 25,
    unit: "ea",
    unitPrice: null,
    orderItemId: "item1",
    issues: ["Check printed quantity"],
    checked: false,
    paper: {
      quantity: 25,
      ordered: 25,
      unit: "ea",
      description: '3" XFR Coupling',
      sku: "3XFRCOUP",
    },
    predictionSource: {
      trialRunId: "trial",
      reader: "astra",
      lineId: "astra1",
      artifactSha256: "a".repeat(64),
      confidence: {
        part: { value: 0.91, basis: "model_estimate", reason: "Tag agrees" },
        match: { value: 0.91, basis: "model_estimate", reason: "Tag agrees" },
        quantity: {
          value: 0.74,
          basis: "model_estimate",
          reason: "Handwriting",
        },
        overall: {
          value: 0.825,
          basis: "model_estimate",
          reason: "Mixed certainty",
        },
      },
    },
  };
  line.resolution = newResolution(line, "reviewer", "2026-11-05T12:00:00Z");
  return {
    document: {
      id: "document",
      jobId: "job",
      folderId: null,
      name: "Packing slip 160-Next.pdf",
      description: "",
      tags: [],
      status: "draft",
      currentVersionId: "version",
      officeWebUrl: null,
      lockedBy: null,
      deletedAt: null,
      createdBy: "scanner",
      createdAt: "2026-11-05",
      updatedAt: "2026-11-05",
      packingSlip: {
        orderId: "order",
        orderNumber: "160-Next",
        materialListId: "list",
        materialListName: "Mechanical",
      },
      packingSlipAnalysis: {
        runId: "analysis",
        versionId: "version",
        status: "ready",
        startedAt: "2026-11-05",
        items: [],
        warnings: [],
        lines: [
          {
            page: 1,
            evidence: "25 EA coupling",
            orderItemId: "item1",
            shipped: 25,
            backordered: null,
            unit: "ea",
            proposed: 25,
            issues: [],
            readings: [
              {
                reader: "jev",
                shipped: 30,
                unit: "ea",
                orderItemId: "item1",
                match: 0.99,
                quantity: 0.99,
              },
            ],
          },
        ],
      },
    },
    review: {
      ...initialReview(undefined, "version", "reviewer"),
      analysisRunId: "analysis",
      orderConfirmed: true,
      kindConfirmed: true,
      supplierName: "Next",
      sourceTrial: { runId: "trial", reader: "astra" },
      lines: [
        line,
        {
          ...line,
          id: "line2",
          sourceIndex: undefined,
          description: "Another unresolved line",
          orderItemId: null,
          resolution: undefined,
          predictionSource: undefined,
        },
      ],
    },
    items: [
      {
        id: "item1",
        description: '3" XFR Coupling',
        sku: "3XFRCOUP",
        aliases: [],
        ordered: 25,
        received: 0,
        unit: "ea",
        verificationStatus: "pending",
        piecesPerPack: null,
        individualUnit: null,
      },
    ],
    fingerprint: "order-totals",
    documents: [],
    duplicates: [],
    suppliers: [],
    catalogs: [],
    units: [],
    lists: [],
    orders: [],
    parts: [],
    photoSuggestions: [],
    canCreate: false,
    scannedBy: "Scanner",
    sourceUrl:
      "/api/job-documents/files/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb?jobId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  detail = fixture();
  run.mockResolvedValue(true);
  reload.mockResolvedValue(undefined);
});
afterEach(cleanup);
function open(target: ResolveTarget = { lineId: "line1" }) {
  return render(
    <ReceivingResolve
      detail={detail}
      jobId="job"
      target={target}
      busy={false}
      run={run}
      onClose={close}
      onSelect={select}
      onReload={reload}
      onAddLine={async (value) => {
        addLine(value);
        return true;
      }}
      renderCorrection={correction}
    />,
  );
}

it("resolves one issue at a time without approving or clearing independent checks", async () => {
  open();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm size & specification" }),
  );
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(run.mock.calls[0]![0]).toEqual({
    action: "resolve",
    lineId: "line1",
    evidenceFingerprint: resolutionEvidenceFingerprint(detail.review.lines[0]!),
    specification: "confirmed",
    note: "",
    skipped: false,
  });
  expect(
    screen.getByText("Confirm the printed quantity and any unit conversion."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Confirm what arrived, or record the delivery issue."),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm quantity & unit" }),
  );
  await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  expect(run.mock.calls[1]![0]).toMatchObject({
    action: "resolve",
    quantity: "confirmed",
  });
  expect(
    run.mock.calls.every(
      ([action]) => action.action !== "approve" && !("delivery" in action),
    ),
  ).toBe(true);
  expect(detail.review.lines[0]!.approved).toBeUndefined();
});

it("Skip saves the review note as unresolved and moves to the next line", async () => {
  open();
  fireEvent.change(screen.getByRole("textbox", { name: "Resolution note" }), {
    target: { value: "Ask the foreman about handwritten count" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(select).toHaveBeenCalledWith({ lineId: "line2" }));
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "resolve",
      lineId: "line1",
      skipped: true,
      note: "Ask the foreman about handwritten count",
    }),
  );
  expect(run.mock.calls[0]![0]).not.toHaveProperty("quantity");
  expect(run.mock.calls[0]![0]).not.toHaveProperty("delivery");
  expect(close).not.toHaveBeenCalled();
});

it("records the site and accepted count separately without overwriting paper quantity", async () => {
  open();
  fireEvent.click(
    screen.getByRole("button", { name: "Record delivery issue" }),
  );
  expect(screen.getByText(/The slip says 25/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Delivery" }), {
    target: { value: "damaged" },
  });
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Counted on site (ea)" }),
    { target: { value: "20" } },
  );
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Accepted to receive (ea)" }),
    { target: { value: "18" } },
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "Outstanding remainder" }),
    { target: { value: "backordered" } },
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Explanation" }), {
    target: { value: "Two couplings damaged; supplier owes seven" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save delivery decision" }),
  );
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(run.mock.calls[0]![0]).toMatchObject({
    action: "resolve",
    delivery: "damaged",
    siteQuantity: 20,
    acceptedQuantity: 18,
    remainder: "backordered",
    excess: null,
    note: "Two couplings damaged; supplier owes seven",
  });
  expect(run.mock.calls[0]![0]).not.toHaveProperty("quantity");
  expect(detail.review.lines[0]!.paper!.quantity).toBe(25);
  expect(detail.review.lines[0]!.quantity).toBe(25);
  expect(detail.review.lines[0]!.approved).toBeUndefined();
});

it("shows paper, reviewed, counted and to-receive quantities distinctly", () => {
  const line = detail.review.lines[0]!;
  line.quantity = 24;
  line.resolution = {
    ...newResolution(line, "reviewer", "now"),
    delivery: "damaged",
    siteQuantity: 20,
    acceptedQuantity: 18,
    note: "Two damaged",
    remainder: "backordered",
  };
  open();
  const evidence = screen.getByRole("button", {
    name: /Astra Max · active saved reading/,
  });
  expect(within(evidence).getByText(/Paper quantity/)).toHaveTextContent("25");
  expect(within(evidence).getByText(/Reviewed quantity/)).toHaveTextContent(
    "24",
  );
  expect(within(evidence).getByText(/Counted on site/)).toHaveTextContent("20");
  expect(within(evidence).getByText(/To receive/)).toHaveTextContent("18");
});

it("identifies the active saved reader and separate confidence scores instead of promoting the highest alternate score", async () => {
  open();
  expect(
    screen.getByRole("button", { name: /Astra Max · active saved reading/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Saved match confidence: 91% · quantity confidence: 74%/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Evidence and other saved readings"));
  expect(
    screen.getByText(/Jev Image · match 99% · quantity 99%/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Use this quantity for review" }),
  );
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "line",
      lineId: "line1",
      quantity: 30,
      checked: false,
    }),
  );
  expect(run.mock.calls[0]![0]).not.toHaveProperty("approved");
});

it("does not offer alternate readings from a different analysis run", () => {
  detail.review.analysisRunId = "older-analysis";
  open();
  fireEvent.click(screen.getByText("Evidence and other saved readings"));
  expect(
    screen.queryByRole("button", { name: "Use this quantity for review" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Jev Image · match/)).not.toBeInTheDocument();
  expect(run).not.toHaveBeenCalled();
});

it("blocks footer mutations when the source version has changed", () => {
  detail.document.currentVersionId = "replacement-version";
  detail.correctionUndo = {
    requestId: "earlier-correction",
    label: "Corrected quantity",
  };
  open();
  expect(screen.getByRole("alert")).toHaveTextContent("source file changed");
  const skip = screen.getByRole("button", { name: "Skip" });
  expect(skip).toBeDisabled();
  const confirm = screen.getByRole("button", { name: "Confirm part match" });
  expect(confirm).toBeDisabled();
  const undo = screen.getByRole("button", { name: "Undo" });
  expect(undo).toBeDisabled();
  fireEvent.click(skip);
  fireEvent.click(confirm);
  fireEvent.click(undo);
  expect(run).not.toHaveBeenCalled();
});

it("passes recovered source text and crop to the missed-line workflow without approving", async () => {
  detail.review.lines[0]!.page = 2;
  open();
  fireEvent.click(
    screen.getByRole("button", { name: "Find on slip / add missed line" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Use recovered line" }));
  await waitFor(() =>
    expect(addLine).toHaveBeenCalledWith({
      page: 2,
      box: { x: 0.1, y: 0.3, width: 0.8, height: 0.04 },
      description: "Recovered printed coupling line",
    }),
  );
  expect(run).not.toHaveBeenCalled();
  expect(detail.review.lines[0]!.approved).toBeUndefined();
});

it("labels an unmatched order item as unlinked without claiming it was not shipped", () => {
  open({ itemId: "item1" });
  expect(
    screen.getByRole("heading", { name: "No slip line linked" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /may be elsewhere on the slip, missed by the scan, or still outstanding/,
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("Not on the slip")).not.toBeInTheDocument();
  expect(run).not.toHaveBeenCalled();
});

it("Skip on an unlinked order row preserves its unresolved note without receiving it", async () => {
  open({ itemId: "item1" });
  fireEvent.change(screen.getByRole("textbox", { name: "Resolution note" }), {
    target: { value: "Check the missing second page" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(run).toHaveBeenCalledWith({
    action: "orderDisposition",
    itemId: "item1",
    disposition: "unresolved",
    note: "Check the missing second page",
  });
  expect(run.mock.calls[0]![0]).not.toHaveProperty("quantity");
});

it("does not advance after the server refuses a resolution save", async () => {
  run.mockResolvedValue(false);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(select).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(
    screen.getByRole("region", { name: "Resolve packing-slip line" }),
  ).toBeInTheDocument();
});

it("linking an order counterpart stays unchecked and never receives quantities", async () => {
  detail.items.push({
    ...detail.items[0]!,
    id: "item2",
    description: "Correct coupling",
    sku: "CORRECT",
  });
  open();
  fireEvent.click(screen.getByRole("button", { name: "Find order item" }));
  fireEvent.click(screen.getByRole("button", { name: /Correct coupling/ }));
  fireEvent.click(screen.getByRole("button", { name: "Link lines" }));
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "line",
      orderItemId: "item2",
      checked: false,
      quantity: 25,
    }),
  );
  expect(run.mock.calls[0]![0]).not.toHaveProperty("approved");
  expect(run.mock.calls[0]![0]).not.toHaveProperty("resolution");
});

it("an ambiguous counterpart unit opens correction without silently converting or linking", async () => {
  detail.review.lines[0]!.unit = "m";
  detail.items.push({
    ...detail.items[0]!,
    id: "item2",
    description: "Pipe sold by length",
    sku: "PIPE",
    unit: "length",
    piecesPerPack: 12,
    individualUnit: "ft",
  });
  open();
  fireEvent.click(screen.getByRole("button", { name: "Find order item" }));
  fireEvent.click(screen.getByRole("button", { name: /Pipe sold by length/ }));
  fireEvent.click(screen.getByRole("button", { name: "Link lines" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "different or ambiguous unit",
  );
  expect(correction).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "line1",
      orderItemId: "item2",
      quantity: 25,
    }),
    expect.any(Function),
  );
  expect(run).not.toHaveBeenCalled();
});

it("does not let a reviewer without substitution permission accept a wrong part", () => {
  detail.canAcceptSubstitution = false;
  open();
  fireEvent.click(
    screen.getByRole("button", { name: "Record delivery issue" }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Delivery" }), {
    target: { value: "wrong" },
  });
  const accept = screen.getByRole("button", { name: "Accept substitute" });
  expect(accept).toBeDisabled();
  fireEvent.click(accept);
  expect(run).not.toHaveBeenCalled();
});
