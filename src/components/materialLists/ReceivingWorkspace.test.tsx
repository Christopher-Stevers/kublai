import { newResolution } from "~/lib/receiving-resolution";
import type { ReceivingLine } from "~/lib/receiving-review";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ReceivingWorkspace } from "./ReceivingWorkspace";
import { runHeaderBackOverride } from "~/lib/header-back-events";
import { LONG_PRESS_MS } from "~/hooks/use-long-press-drag";
const push = vi.fn();
const replace = vi.fn();
const navigation = vi.hoisted(() => ({ query: "document=doc" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: null, isLoaded: true }),
}));
vi.mock("~/components/jobs/documents/DocumentPdfPreview", () => ({
  DocumentPdfPreview: () => <div>Source PDF</div>,
}));
vi.mock("./SlipLineImage", () => ({
  SlipLineImage: ({
    page,
    box,
    initiallyZoomed,
  }: {
    page: number;
    box: unknown;
    initiallyZoomed?: boolean;
  }) => (
    <div
      role="img"
      aria-label={`Slip crop page ${page}`}
      data-box={JSON.stringify(box)}
      data-zoomed={String(initiallyZoomed)}
    />
  ),
}));
vi.mock("~/hooks/use-replicache-material-list", () => ({
  useReplicacheMaterialList: () => ({ items: [], materialList: null }),
  useReplicacheSyncing: () => false,
  resolveReplicacheSyncStatus: () => "synced",
}));
function fixture() {
  return {
    documents: [],
    document: {
      id: "doc",
      name: "Packing slip.pdf",
      createdAt: "2026-10-27",
      currentVersionId: "v",
      packingSlip: { orderId: "order", orderNumber: "PO-155" } as
        | { orderId: string; orderNumber: string }
        | undefined,
      packingSlipAnalysis: {
        progress: undefined as SlipAnalysis["progress"],
        orderCandidates: [] as string[],
        runId: "run",
        versionId: "v",
        status: "ready" as SlipAnalysis["status"],
        items: [],
        lines: [],
        warnings: [],
      },
    },
    review: {
      revision: 1,
      versionId: "v",
      kind: "delivery",
      kindConfirmed: true,
      orderConfirmed: true,
      documentChecked: false,
      supplierId: "supplier",
      supplierName: "Supplier",
      deliveryNumber: "123",
      supplierOrderNumber: "",
      deliveryDate: "",
      lines: [
        {
          approved: undefined as ReceivingLine["approved"],
          id: "0",
          description: "Valve",
          sku: "V123",
          page: 1,
          evidence: "6 EA Valve",
          quantity: 6,
          unit: "ea",
          orderItemId: "item",
          issues: [],
          unitPrice: null,
          ordered: 10,
        },
        {
          id: "1",
          description: "Unclear pipe",
          page: 1,
          evidence: "Unreadable quantity",
          quantity: null,
          unit: "ea",
          orderItemId: null,
          issues: ["Quantity unclear"],
          unitPrice: null,
          ordered: null,
        },
      ],
      warnings: [],
    },
    items: [
      {
        id: "item",
        description: "Valve",
        unit: "ea",
        ordered: 10,
        received: 2,
        aliases: [] as string[],
        piecesPerPack: null as number | null,
        individualUnit: null as string | null,
      },
    ],
    fingerprint: "current-totals",
    duplicates: [],
    suppliers: [{ id: "supplier", name: "Supplier" }],
    orders: [{ id: "order", name: "PO-155", supplierId: "supplier" }],
    lists: [],
    catalogs: [],
    units: [],
    parts: [],
    photoSuggestions: [],
    canCreate: false,
    sourceUrl: "/source",
    scannedBy: "Scanner",
  };
}
let state: ReturnType<typeof fixture>, posts: Array<Record<string, unknown>>;
beforeEach(() => {
  navigation.query = "document=doc";
  posts = [];
  state = fixture();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        const body = JSON.parse(
          typeof opts.body === "string" ? opts.body : "{}",
        ) as Record<string, unknown>;
        posts.push(body);
        if (body.action === "approve")
          state.review.lines[0]!.approved = {
            itemId: "item",
            quantity: 6,
            kind: "delivery",
            by: "receiver",
            at: "now",
          };
        state.review.revision++;
        return Response.json({ success: true });
      }
      return Response.json(state);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows source issues and never receives automatically", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByRole("heading", { name: "Valve" });
  expect(screen.getByText("Unclear pipe")).toBeInTheDocument();
  expect(posts).toEqual([]);
  expect(screen.getByRole("link", { name: "Packing slip.pdf" })).toHaveAttribute(
    "href",
    "/jobs/job/documents?document=doc&from=receiving",
  );
});
it("steps back from a slip to the receiving queue", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByRole("heading", { name: "Valve" });
  expect(screen.queryByRole("link", { name: /Receiving queue/ })).toBeNull();
  runHeaderBackOverride();
  expect(replace).toHaveBeenCalledWith("/jobs/job/receiving");
});
it("keeps reader comparison and slip tools in the lab", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByRole("heading", { name: "Valve" });
  expect(screen.queryByRole("button", { name: "Rerun detection" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Slip lab/ }));
  const lab = await screen.findByRole("dialog", { name: /Slip lab/ });
  expect(
    within(lab).getByRole("button", { name: "Rerun detection" }),
  ).toBeInTheDocument();
});
it("opens the full document from its name and removes both redundant buttons", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  const step = await screen.findByRole("region", {
    name: "Step 3: Line By Line Matching",
  });
  expect(within(step).queryByRole("link", { name: "View slip" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "View source" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Packing slip.pdf" })).toHaveAttribute(
    "href",
    "/jobs/job/documents?document=doc&from=receiving",
  );
});
it("previews and approves only ready lines, retaining unresolved lines", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review & approve" }),
  );
  expect(
    screen.getByRole("heading", { name: "Approve 1 line" }),
  ).toBeInTheDocument();
  expect(posts).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Approve ready lines" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "approve",
    jobId: "job",
    documentId: "doc",
    lineIds: ["0"],
    fingerprint: "current-totals",
    revision: 1,
  });
  expect(posts[0]!.requestId).toMatch(/^[0-9a-f-]{36}$/);
  await screen.findByText(
    "Approved quantities updated. Unresolved lines remain in the queue.",
  );
  expect(screen.getByText("Unclear pipe")).toBeInTheDocument();
});
it("keeps the activity log visible when detailed progress is hidden", async () => {
  state.document.packingSlipAnalysis.status = "processing";
  state.document.packingSlipAnalysis.progress = {
    stage: "extracting",
    message: "Reading the scanned pages…",
  };
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findAllByText("Reading the scanned pages…");
  fireEvent.click(screen.getByRole("button", { name: "Hide progress" }));
  fireEvent.click(screen.getByRole("button", { name: /Processing activity/ }));
  expect(
    within(
      screen.getByRole("region", { name: "Processing activity" }),
    ).getByText("Reading the scanned pages…"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Review & approve" }),
  ).toBeDisabled();
  expect(posts).toEqual([]);
});
it("requires review of a new source version before approving", async () => {
  state.document.currentVersionId = "new";
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByText(/file has a newer version/);
  expect(
    screen.getByRole("button", { name: "Review & approve" }),
  ).toBeDisabled();
});
it("links a newly chosen order before confirming the slip details", async () => {
  state.review.orderConfirmed = false;
  state.review.kindConfirmed = false;
  state.orders.push({ id: "order-2", name: "PO-156", supplierId: "other" });
  state.suppliers.push({ id: "other", name: "Other supplier" });
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Choose another order" }),
  );
  fireEvent.change(screen.getByLabelText("Order in this job"), {
    target: { value: "order-2" },
  });
  expect(screen.getByLabelText("Supplier")).toHaveValue("other");
  // One confirm button; the page check comes with approving the lines.
  expect(screen.queryByRole("checkbox")).toBeNull();
  for (const name of ["Back", "New supplier", "Confirm details"])
    expect(screen.queryByRole("button", { name })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "I confirm this is the correct order" }),
  );
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[0]).toMatchObject({
    action: "link",
    orderId: "order-2",
    revision: 1,
  });
  expect(posts[1]).toMatchObject({
    action: "header",
    supplierId: "other",
    confirmed: true,
    documentChecked: false,
    revision: 2,
  });
});
it("confirms the matched order in one tap and only then compares lines", async () => {
  state.review.orderConfirmed = false;
  state.review.kindConfirmed = false;
  render(<ReceivingWorkspace jobId="job" />);
  const order = await screen.findByRole("region", {
    name: "Step 2: Match",
  });
  expect(order).toHaveTextContent("Packing Slip Matched To 'PO-155'");
  expect(order).toHaveTextContent("PO-155");
  expect(
    screen.getByRole("region", { name: "Step 3: Line By Line Matching" }),
  ).toHaveTextContent("After the order is confirmed.");
  expect(screen.queryByRole("heading", { name: "Valve" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: "I confirm this is the correct order",
    }),
  );
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "header",
    kind: "delivery",
    supplierId: "supplier",
    confirmed: true,
  });
});
it("leaves out a line that was not delivered in one tap", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review line: Valve" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Not delivered" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "ignore",
    lineId: "0",
    reason: "Not delivered.",
  });
});
it("warns about a repeat scan first and records what it is", async () => {
  state.duplicates = [
    {
      id: "old",
      name: "Earlier slip.jpg",
      reason: "The uploaded file is identical.",
      key: "old:v1",
      received: true,
    },
  ] as typeof state.duplicates;
  render(<ReceivingWorkspace jobId="job" />);
  const check = await screen.findByRole("region", {
    name: "Step 1: Duplicate Check",
  });
  expect(check).toHaveTextContent("This slip may have been scanned before.");
  expect(check).toHaveTextContent("Earlier slip.jpg");
  expect(check).toHaveTextContent("It has already been received.");
  expect(
    screen.getByRole("region", { name: "Step 2: Match" }),
  ).toHaveTextContent("After the duplicate check.");
  expect(
    screen.getByRole("button", { name: "Review & approve" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Different delivery" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "duplicate",
    decision: "additional",
    otherDocumentId: "old",
  });
});
it("lists every order item beside the slip reading and its reader", async () => {
  Object.assign(state.review.lines[0]!, {
    readingSource: {
      analysisRunId: "run",
      reader: "terra",
      confidence: { part: 0.99, quantity: 0.97, basis: "model_estimate" },
    } satisfies ReceivingLine["readingSource"],
  });
  state.items.push({
    id: "item-2",
    description: "Elbow",
    unit: "ea",
    ordered: 4,
    received: 0,
    aliases: [],
    piecesPerPack: null,
    individualUnit: null,
  });
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByRole("heading", { name: "Valve" });
  expect(
    screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
  ).toEqual(["Valve", "Elbow", "Empty"]);
  const valve = screen.getByRole("heading", { name: "Valve" }).closest("li")!;
  expect(valve).toHaveTextContent("ValveOrdered10Received28 still due");
  expect(
    within(valve).getByRole("group", { name: "Active saved reading reading" }),
  ).toHaveTextContent("Received6");
  fireEvent.click(within(valve).getByRole("button", { name: /other reader/ }));
  const terra = within(valve).getByRole("group", { name: "Terra 6.1 reading" });
  expect(terra).toHaveTextContent("98%");
  expect(terra).toHaveTextContent("Received6");
  expect(terra).toHaveTextContent("2 short");
  const elbow = screen.getByRole("heading", { name: "Elbow" }).closest("li")!;
  expect(elbow).toHaveTextContent("4 still due");
  expect(elbow).toHaveTextContent("No slip line linked");
  const pipe = screen
    .getByRole("heading", { name: "Unclear pipe" })
    .closest("li")!;
  expect(pipe).toHaveTextContent("Not on the order");
  expect(pipe).toHaveTextContent("Not read");
  fireEvent.click(
    screen.getByRole("button", { name: "Review line: Unclear pipe" }),
  );
  expect(
    screen.getByText("The reading is unsure. Check it against the slip."),
  ).toBeInTheDocument();
  expect(screen.getByText("Quantity unclear")).not.toBeVisible();
  expect(screen.getByLabelText("Quantity")).toHaveValue(null);
  expect(
    screen.getByRole("button", { name: "Save and confirm" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Review line: Valve" }));
  expect(screen.queryByText("Quantity unclear")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Quantity")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "line",
    lineId: "0",
    orderItemId: "item",
    quantity: 6,
    unit: "ea",
    checked: true,
  });
});
it("offers to set a part's pack size when the slip counts pieces", async () => {
  Object.assign(state.review.lines[0]!, {
    description: "HEX NUT GR2 ZC,3/8-16",
    sku: "HN38G2ZB",
    evidence: "HN38G2ZB HEX NUT GR2 ZC,3/8-16 2500 2500 0",
    quantity: 2500,
    ordered: 2500,
    unit: "box",
  });
  Object.assign(state.items[0]!, {
    description: "HEX NUT GR2 ZINC 3/8-16 - BULK (Bulk Box = 2500pcs)",
    unit: "box",
    ordered: 1,
    received: 0,
  });
  const part = {
    partId: "part",
    name: "Hex nut",
    bulkUnit: null,
    supplierSku: null,
    supplierName: null,
    units: ["box"],
  };
  Object.assign(state, { canEditParts: true, orderParts: { item: part } });
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: /^Review line: HEX NUT GR2/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
  const ask = await screen.findByRole("dialog", {
    name: "Update this part to match the slip?",
  });
  expect(ask).toHaveTextContent(
    "The slip shows 2500 where the order needs 1 box. That is 1 box of 2500 ea each.",
  );
  expect(ask).toHaveTextContent("Pack sizeNot set2500 ea per box");
  expect(ask).toHaveTextContent("Supplier codeNot setHN38G2ZB");
  expect(posts).toEqual([]);
  fireEvent.click(
    within(ask).getByRole("button", { name: "Update part and receive 1 box" }),
  );
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "line",
    orderItemId: "item",
    quantity: 1,
    ordered: 1,
    unit: "box",
    checked: true,
    fit: {
      piecesPerPack: 2500,
      individualUnit: "ea",
      bulkUnit: "box",
      supplierSku: "HN38G2ZB",
      supplierName: "HEX NUT GR2 ZC,3/8-16",
    },
  });
  // Without the right to edit parts, it only offers to read the count.
  cleanup();
  Object.assign(state, { canEditParts: false });
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: /^Review line: HEX NUT GR2/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
  const read = await screen.findByRole("dialog", { name: "Receive 1 box?" });
  fireEvent.click(within(read).getByRole("button", { name: "Keep 2500 box" }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]).toMatchObject({ quantity: 2500, unit: "box" });
  expect(posts[1]).not.toHaveProperty("fit");
});
it("asks to allow over-delivery only when a line exceeds what is due", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review & approve" }),
  );
  expect(screen.getByText(/Received 2 → 8 of 10/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/above the amount still due/)).toBeNull();
  cleanup();
  state.review.lines[0]!.quantity = 9;
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review & approve" }),
  );
  expect(screen.getByText("1 over")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/above the amount still due/));
  fireEvent.click(screen.getByRole("button", { name: "Approve ready lines" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "approve",
    allowOverDelivery: true,
  });
});

it("shows where a received count came from and lets the slip take over a hand count", async () => {
  // Marked received by hand on the order before this slip was reviewed.
  state.items[0]!.received = 10;
  Object.assign(state, {
    receipts: { item: { slips: [], byHand: 10 } },
  });
  render(<ReceivingWorkspace jobId="job" />);
  const from = await screen.findByRole("list", { name: "Received from" });
  expect(from).toHaveTextContent("10 counted by hand on the order");
  expect(screen.getByText("Counted by hand already")).toBeInTheDocument();
  expect(screen.queryByText(/more than needed/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review & approve" }));
  const same = screen.getByRole("radio", { name: /^Same parts/ });
  expect(same).toBeChecked();
  expect(
    screen.getByText(
      /Received 10 → 10 of 10 · 6 counted by hand, now on this slip/,
    ),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText(/above the amount still due/)).toBeNull();
  // Counting it again would be over.
  fireEvent.click(screen.getByRole("radio", { name: /^A separate delivery/ }));
  expect(screen.getByText("6 over")).toBeInTheDocument();
  fireEvent.click(same);
  fireEvent.click(screen.getByRole("button", { name: "Approve ready lines" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "approve",
    allowOverDelivery: false,
    fromHandCount: true,
  });
});
it("asks whether a slip within what is due repeats a hand count", async () => {
  Object.assign(state, {
    receipts: {
      item: {
        byHand: 2,
        slips: [
          {
            documentId: "older",
            name: "Earlier slip.pdf",
            quantity: -1,
            by: "Sam",
            at: "2026-10-30T10:00:00Z",
            self: false,
          },
        ],
      },
    },
  });
  render(<ReceivingWorkspace jobId="job" />);
  const from = await screen.findByRole("list", { name: "Received from" });
  expect(from).toHaveTextContent("2 counted by hand on the order");
  expect(from).toHaveTextContent("1 returned on Earlier slip.pdf · Sam");
  expect(
    within(from).getByRole("link", { name: "Earlier slip.pdf" }),
  ).toHaveAttribute("href", "?document=older");
  fireEvent.click(screen.getByRole("button", { name: "Review & approve" }));
  const approve = screen.getByRole("button", { name: "Approve ready lines" });
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /^A separate delivery/ }));
  expect(screen.getByText(/Received 2 → 8 of 10/)).toBeInTheDocument();
  fireEvent.click(approve);
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ action: "approve", fromHandCount: false });
});

it("lists slips to review with one next step each, suggested orders first", async () => {
  navigation.query = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/trials")
        ? Response.json({
            trial: {
              runId: "trial",
              updatedAt: "now",
              counts: {
                ocr: { complete: 3, failed: 0, total: 3 },
                jev: { complete: 1, failed: 0, total: 3 },
              },
              cases: [],
            },
          })
        : Response.json({
            documents: [
              {
                id: "new",
                name: "New unresolved slip",
                createdAt: "2026-10-27",
                status: "review",
                pending: 2,
                approved: 0,
                hasSuggestedOrder: false,
              },
              {
                id: "suggested",
                name: "Older suggested slip",
                createdAt: "2026-10-26",
                status: "review",
                pending: 1,
                approved: 0,
                hasSuggestedOrder: true,
                order: { orderId: "o", orderNumber: "PO-7" },
              },
              {
                id: "done",
                name: "Received slip",
                createdAt: "2026-10-25",
                status: "complete",
                pending: 0,
                approved: 3,
              },
            ],
          }),
    ),
  );
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByText("Older suggested slip");
  const rows = () => screen.getAllByRole("link").filter((a) => a.closest("li"));
  expect(rows().map((r) => r.textContent)).toEqual([
    expect.stringContaining("Older suggested slip"),
    expect.stringContaining("New unresolved slip"),
  ]);
  expect(rows()[0]).toHaveTextContent("PO-7");
  expect(rows()[0]).toHaveTextContent("Confirm order");
  expect(rows()[0]).toHaveAttribute(
    "href",
    "/jobs/job/receiving?document=suggested",
  );
  expect(rows()[1]).toHaveTextContent("2 to check");
  expect(screen.getByRole("button", { name: "To review 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByText(/Reader comparison/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Refresh receiving queue" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  expect(rows()).toHaveLength(3);
  expect(rows()[2]).toHaveTextContent("Done");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search packing slips" }),
    { target: { value: "Older" } },
  );
  expect(rows()).toHaveLength(1);
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search packing slips" }),
    { target: { value: "nothing like it" } },
  );
  expect(screen.getByText("No slips match.")).toBeInTheDocument();
});
it("shows every reader's part match and quantity confidence", async () => {
  Object.assign(state.review, { analysisRunId: "run" });
  Object.assign(state.review.lines[0]!, { sourceIndex: 0 });
  Object.assign(state.document.packingSlipAnalysis, {
    lines: [
      {
        page: 1,
        evidence: "6 EA Valve",
        orderItemId: "item",
        shipped: 6,
        backordered: null,
        unit: "ea",
        proposed: null,
        issues: [],
        source: "terra",
        readings: [
          {
            reader: "ocr",
            shipped: 5,
            unit: "ea",
            orderItemId: "item",
            match: 0.4,
            quantity: 0.55,
          },
          {
            reader: "jev",
            shipped: 6,
            unit: "ea",
            orderItemId: "item",
            match: 0.9,
            quantity: 0.7,
          },
          {
            reader: "terra",
            shipped: 6,
            unit: "ea",
            orderItemId: "item",
            match: 0.98,
            quantity: 0.96,
          },
        ],
      },
    ],
  });
  render(<ReceivingWorkspace jobId="job" />);
  const valve = (await screen.findByRole("heading", { name: "Valve" })).closest(
    "li",
  )!;
  const readers = () =>
    within(valve)
      .getAllByRole("group", { name: / reading$/ })
      .map((g) => g.textContent);
  // Active saved evidence first; alternative scores cannot silently change the receipt.
  expect(readers()).toEqual([
    "Active saved readingValveOrdered10Received62 short3 other readers",
  ]);
  fireEvent.click(
    within(valve).getByRole("button", { name: /3 other readers/ }),
  );
  expect(readers()).toEqual([
    "Active saved readingValveOrdered10Received62 shortHide other readers",
    "Terra 6.197%ValveOrdered—Received62 short",
    "Jev Image80%ValveOrdered—Received62 short",
    "OCR only48%ValveOrdered—Received53 short",
  ]);
});
it("says when Terra found no product on a row and leaves it out in one tap", async () => {
  Object.assign(state.review.lines[1]!, {
    readingSource: {
      analysisRunId: "run",
      reader: "jev",
      confidence: { part: 0.63, quantity: 0.63, basis: "model_estimate" },
    } satisfies ReceivingLine["readingSource"],
    issues: [
      "Terra found no product on this row. It may be a carton, total or note line.",
    ],
  });
  render(<ReceivingWorkspace jobId="job" />);
  const pipe = (
    await screen.findByRole("heading", { name: "Unclear pipe" })
  ).closest("li")!;
  fireEvent.click(within(pipe).getByRole("button", { name: /other reader/ }));
  expect(
    within(pipe).getByRole("group", { name: "Jev Image reading" }),
  ).toHaveTextContent("Jev Image63%Unclear pipeOrdered—ReceivedNot read");
  expect(pipe).toHaveTextContent("Terra 6.1 found no product here");
  fireEvent.click(
    screen.getByRole("button", { name: "Review line: Unclear pipe" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Not a product, leave it out" }),
  );
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "ignore",
    lineId: "1",
    reason: "Not a product line.",
  });
});

it("allows a matched quantity to reach approval without entering a unit", async () => {
  state.review.lines[0]!.unit = "";
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review & approve" }),
  );
  expect(
    screen.getByRole("heading", { name: "Approve 1 line" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Approve ready lines" }));
  await waitFor(() =>
    expect(posts[0]).toMatchObject({ action: "approve", lineIds: ["0"] }),
  );
});

it("shows a suggestion arriving after mount and confirms that order explicitly", async () => {
  state.document.packingSlip = undefined;
  state.document.packingSlipAnalysis.status = "processing";
  state.review.orderConfirmed = false;
  state.review.kindConfirmed = false;
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByText("Finding the order while the slip is read…");
  state.document.packingSlipAnalysis.orderCandidates = ["order"];
  await screen.findByText("Packing Slip Matched To 'PO-155'", {}, { timeout: 6000 });
  expect(
    screen.getByRole("button", {
      name: "I confirm this is the correct order",
    }),
  ).toBeDisabled();
  expect(screen.queryByText(/lines? ready to approve/)).not.toBeInTheDocument();
  state.document.packingSlipAnalysis.status = "ready";
  await screen.findByText("Order confirmation required", {}, { timeout: 6000 });
  expect(posts).toEqual([]);
  expect(
    screen.getByRole("button", { name: "Review & approve" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "I confirm this is the correct order",
    }),
  );
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[0]).toMatchObject({
    action: "link",
    orderId: "order",
    confirmed: true,
  });
  expect(posts[1]).toMatchObject({
    action: "header",
    supplierId: "supplier",
    confirmed: true,
  });
}, 15000);

it("preserves a manual order choice when a suggestion arrives during polling", async () => {
  state.document.packingSlip = undefined;
  state.review.orderConfirmed = false;
  state.review.kindConfirmed = false;
  state.orders.push({
    id: "manual",
    name: "Manual order",
    supplierId: "other",
  });
  state.suppliers.push({ id: "other", name: "Other supplier" });
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.change(await screen.findByLabelText("Order in this job"), {
    target: { value: "manual" },
  });
  fireEvent.change(screen.getByLabelText("Delivery / packing slip number"), {
    target: { value: "my-slip" },
  });
  state.document.packingSlipAnalysis.orderCandidates = ["order"];
  await screen.findByRole(
    "option",
    { name: /Suggested match/ },
    { timeout: 6000 },
  );
  expect(screen.getByLabelText("Order in this job")).toHaveValue("manual");
  expect(screen.getByLabelText("Supplier")).toHaveValue("other");
  expect(screen.getByLabelText("Delivery / packing slip number")).toHaveValue(
    "my-slip",
  );
  expect(posts).toEqual([]);
}, 10000);

function notOnOrder(quantity: number | null) {
  state.canCreate = true;
  state.review.lines[1]!.quantity = quantity;
  state.document.packingSlip = {
    orderId: "order",
    orderNumber: "PO-155",
    materialListName: "Level 3",
  } as typeof state.document.packingSlip;
  Object.assign(state, {
    catalogs: [{ id: "cat", name: "Plumbing" }],
    likely: {
      "1": [
        {
          id: "pipe",
          name: "Copper pipe",
          description: null,
          photoUrl: null,
          catalogId: "cat",
          unit: "ft",
          piecesPerPack: null,
          individualUnit: null,
          score: 0.8,
          code: true,
        },
      ],
    },
  });
}
it("puts a missed slip line with the order line of its likely part", async () => {
  state.items.push({
    id: "pipe-item",
    description: "Copper pipe",
    unit: "ea",
    ordered: 3,
    received: 0,
    aliases: [],
    piecesPerPack: null,
    individualUnit: null,
  });
  Object.assign(state, { pairs: { "1": "pipe-item" } });
  try {
    render(<ReceivingWorkspace jobId="job" />);
    expect(
      await screen.findByText(/The slip line is likely this part/),
    ).toBeVisible();
    expect(screen.queryByText("Not on the order")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Copper pipe" }),
    ).toHaveLength(1);
  } finally {
    state.items.pop();
    delete (state as { pairs?: unknown }).pairs;
  }
});
it("adds the likely catalogue part to the material list in one tap", async () => {
  notOnOrder(3);
  render(<ReceivingWorkspace jobId="job" />);
  expect(await screen.findByText(/Likely Copper pipe/)).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Review line: Unclear pipe" }),
  );
  expect(screen.getByText(/puts it on Level 3 with 3 ordered/)).toBeVisible();
  const likely = screen.getByRole("list", { name: "Likely catalogue parts" });
  expect(within(likely).getByText("Same supplier code")).toBeVisible();
  fireEvent.click(
    within(likely).getByRole("button", { name: "Add Copper pipe to the list" }),
  );
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "part",
    lineId: "1",
    partId: "pipe",
    catalogId: "cat",
    unit: "ft",
    addToOrder: true,
  });
});
it("confirms EA means one complete pipe length before adding it", async () => {
  notOnOrder(1);
  state.review.lines[1]!.unit = "EA";
  Object.assign(
    (
      state as typeof state & {
        likely: Record<string, Array<Record<string, unknown>>>;
      }
    ).likely["1"]![0]!,
    {
      unit: "length",
      piecesPerPack: 12,
      individualUnit: "ft",
    },
  );
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review line: Unclear pipe" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Add Copper pipe to the list" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Confirm what “each” means",
  });
  expect(dialog).toHaveTextContent("one length contains 12 ft");
  expect(dialog).toHaveTextContent("Delivered: 1 length");
  expect(posts).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(posts).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Add Copper pipe to the list" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Yes, add as length" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "part",
    partId: "pipe",
    unit: "length",
    piecesPerPack: 12,
    packageUnitConfirmed: true,
  });
});
it("adds a new part to ForemanHQ and the material list together", async () => {
  notOnOrder(3);
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review line: Unclear pipe" }),
  );
  const add = screen.getByRole("button", { name: "New part in ForemanHQ" });
  fireEvent.click(add);
  expect(add).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(
    screen.getByRole("button", { name: "Add to ForemanHQ and the list" }),
  );
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "part",
    lineId: "1",
    partId: null,
    name: "Unclear pipe",
    catalogId: "cat",
    addToOrder: true,
  });
});
it("asks for the quantity before a part goes on the list", async () => {
  notOnOrder(null);
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review line: Unclear pipe" }),
  );
  expect(
    screen.getByText("Enter the quantity that came below and save it first."),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Add Copper pipe to the list" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "New part in ForemanHQ" }),
  );
  expect(
    screen.getByRole("button", { name: "Add to ForemanHQ and the list" }),
  ).toBeDisabled();
});
it("confirms the one order at 90% match confidence without asking", async () => {
  state.review.orderConfirmed = false;
  state.review.kindConfirmed = false;
  state.orders.push({ id: "order-2", name: "PO-156", supplierId: "other" });
  const ranked = (confidence: number) => [
    {
      orderId: "order-2",
      orderNumber: "PO-156",
      supplier: "Other",
      listName: "List",
      sentAt: null,
      found: 4,
      weak: false,
      confidence,
    },
  ];
  const answer = vi.mocked(fetch).getMockImplementation()!;
  let confidence = 80;
  vi.mocked(fetch).mockImplementation(async (url, opts) =>
    (url as string).includes("rankOrders")
      ? Response.json(ranked(confidence))
      : answer(url, opts),
  );
  const view = render(<ReceivingWorkspace jobId="job" />);
  await screen.findByText(/80% match confidence/);
  expect(posts).toEqual([]);
  expect(
    screen.getByRole("button", { name: "I confirm this is the correct order" }),
  ).toBeInTheDocument();
  view.unmount();
  confidence = 94;
  render(<ReceivingWorkspace jobId="job" />);
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[0]).toMatchObject({ action: "link", orderId: "order-2" });
  expect(posts[1]).toMatchObject({
    action: "header",
    supplierId: "other",
    confirmed: true,
  });
});
it("folds line by line matching once every line is approved or excluded", async () => {
  state.review.lines[0]!.approved = {
    itemId: "item",
    quantity: 6,
    kind: "delivery",
    by: "receiver",
    at: "now",
  };
  Object.assign(state.review.lines[1]!, { ignored: true });
  render(<ReceivingWorkspace jobId="job" />);
  const step = await screen.findByRole("region", {
    name: "Step 3: Line By Line Matching",
  });
  expect(step).toHaveTextContent("1 approved");
  expect(within(step).queryByRole("heading", { name: "Valve" })).toBeNull();
  fireEvent.click(within(step).getByRole("button", { name: "Show lines" }));
  expect(
    within(step).getByRole("heading", { name: "Valve" }),
  ).toBeInTheDocument();
  fireEvent.click(within(step).getByRole("button", { name: "Hide lines" }));
  expect(within(step).queryByRole("heading", { name: "Valve" })).toBeNull();
});

it("includes an auto-confirmed flagged line in review without posting on load", async () => {
  Object.assign(state.review.lines[0]!, {
    checked: false,
    autoConfirmed: true,
    issues: ["Check quantity"],
  });
  render(<ReceivingWorkspace jobId="job" />);
  const approve = await screen.findByRole("button", {
    name: "Review & approve",
  });
  expect(approve).toBeEnabled();
  expect(posts).toEqual([]);
  fireEvent.click(approve);
  expect(
    screen.getByRole("heading", { name: "Approve 1 line" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Approve ready lines" }));
  await waitFor(() =>
    expect(posts[0]).toMatchObject({ action: "approve", lineIds: ["0"] }),
  );
});

it("opens the material-list item from the left column and closes without editing receipts", async () => {
  Object.assign(state.items[0]!, { sku: "V123" });
  Object.assign(state, {
    orderParts: {
      item: {
        partId: "part",
        name: "Valve",
        imageUrl: "/valve.png",
        bulkUnit: "ea",
        units: ["ea"],
        supplierSku: "V123",
        supplierName: "Valve",
      },
    },
  });
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "View material-list item: Valve",
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Material-list item" });
  expect(within(dialog).getByText("Supplier")).toBeInTheDocument();
  expect(within(dialog).getByText("V123")).toBeInTheDocument();
  expect(within(dialog).getByAltText("Valve")).toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: "Verify part" }),
  ).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(posts).toEqual([]);
});
it("opens an enlarged source crop from the right column and keeps editing on the arrow", async () => {
  const box = { x: 0.1, y: 0.4, width: 0.8, height: 0.04 };
  Object.assign(state.review.lines[0]!, { sourceBox: box, page: 2 });
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "View packing-slip line: Valve (Slip)",
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Packing-slip line" });
  expect(
    within(dialog).getByRole("img", { name: "Slip crop page 2" }),
  ).toHaveAttribute("data-box", JSON.stringify(box));
  expect(within(dialog).getByRole("img")).toHaveAttribute(
    "data-zoomed",
    "true",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Review line: Valve" }));
  expect(
    screen.getByRole("button", { name: "Looks right" }),
  ).toBeInTheDocument();
  expect(posts).toEqual([]);
});
it("shows the source page when a slip line has no crop, and never shows a crop from a replaced file", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "View packing-slip line: Unclear pipe (Slip)",
    }),
  );
  expect(
    screen.getByText(/Exact line position unavailable/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  cleanup();
  state.document.currentVersionId = "replacement";
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "View packing-slip line: Valve (Slip)",
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Packing-slip line" });
  expect(within(dialog).queryByRole("img")).toBeNull();
  expect(
    within(dialog).getByText(/The source file changed/),
  ).toBeInTheDocument();
});

it("completes a matching comparison after Looks right, before receiving approval", async () => {
  state.review.lines[0]!.quantity = 8;
  state.review.lines[0]!.issues = ["Readers disagree"];
  const fetchMock = vi.mocked(fetch);
  const originalFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, opts) => {
    if (opts?.method === "POST") {
      const body = JSON.parse(
        typeof opts.body === "string" ? opts.body : "{}",
      ) as Record<string, unknown>;
      if (body.action === "line")
        Object.assign(state.review.lines[0]!, {
          checked: body.checked === true,
        });
    }
    return originalFetch(url, opts);
  });
  render(<ReceivingWorkspace jobId="job" />);
  const row = (await screen.findByRole("heading", { name: "Valve" })).closest(
    "li",
  )!;
  const circle = () => row.querySelector("[data-comparison-state]")!;
  expect(circle()).toHaveAttribute("data-comparison-state", "pending");
  fireEvent.click(
    within(row).getByRole("button", { name: "Review line: Valve" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
  await waitFor(() =>
    expect(circle()).toHaveAttribute("data-comparison-state", "complete"),
  );
  expect(circle()).toHaveClass("bg-emerald-600");
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: "line", checked: true });
  expect(state.review.lines[0]!.approved).toBeUndefined();
});

it.each([
  { checked: false, quantity: 8, orderItemId: "item" },
  { checked: true, quantity: 6, orderItemId: "item" },
  { checked: true, quantity: 9, orderItemId: "item" },
  { checked: true, quantity: null, orderItemId: "item" },
  { checked: true, quantity: 8, orderItemId: null },
])("keeps incomplete comparisons pending: %j", async (line) => {
  Object.assign(state.review.lines[0]!, line);
  render(<ReceivingWorkspace jobId="job" />);
  const headings = await screen.findAllByRole("heading", { name: "Valve" });
  for (const heading of headings)
    expect(
      heading.closest("li")!.querySelector("[data-comparison-state]"),
    ).toHaveAttribute("data-comparison-state", "pending");
});

it.each([
  { checked: true, trial: false },
  { checked: false, trial: false },
  { checked: true, trial: true },
  { checked: false, trial: true },
])(
  "keeps the source model visible when a line is confirmed or edited (%j)",
  async ({ checked, trial }) => {
    Object.assign(state.review.lines[0]!, {
      checked,
      humanEdited: true,
      readingSource: {
        analysisRunId: "run",
        reader: "terra",
        confidence: {
          part: 0.98,
          match: 0.98,
          quantity: 0.96,
          basis: "model_estimate",
        },
      },
    });
    if (trial) {
      const confidence = {
        value: 0.99,
        basis: "self_assessed",
        reason: "Readable source",
      };
      Object.assign(state.review.lines[0]!, {
        predictionSource: {
          trialRunId: "trial",
          reader: "astra",
          lineId: "line",
          confidence: {
            part: confidence,
            match: confidence,
            quantity: confidence,
            overall: confidence,
          },
        },
      });
    }
    const model = trial ? "Astra Max" : "Terra 6.1";
    render(<ReceivingWorkspace jobId="job" />);
    const row = (await screen.findByRole("heading", { name: "Valve" })).closest(
      "li",
    )!;
    const reading = within(row).getByRole("group", {
      name: `${model} reading`,
    });
    expect(reading).toHaveTextContent(model);
    expect(
      within(reading).getByLabelText(
        `Review status: ${checked ? "Confirmed" : "Edited"}`,
      ),
    ).toBeInTheDocument();
    expect(within(reading).queryByText("97%")).toBeNull();
    expect(posts).toEqual([]);
  },
);
it("labels a reviewer-added line without model provenance as a manual review", async () => {
  Object.assign(state.review.lines[0]!, { checked: true, humanEdited: true });
  render(<ReceivingWorkspace jobId="job" />);
  const row = (await screen.findByRole("heading", { name: "Valve" })).closest(
    "li",
  )!;
  expect(
    within(row).getByRole("group", { name: "Manual review reading" }),
  ).toHaveTextContent("Confirmed");
});

it("confirms removal of an unmatched order item without recording delivery", async () => {
  Object.assign(state, { canRemoveOrderItems: true });
  state.items[0]!.received = 0;
  state.review.lines[0]!.orderItemId = null;
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove from order" }),
  );
  let dialog = await screen.findByRole("dialog", {
    name: "Remove item from order?",
  });
  expect(posts).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(posts).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Remove from order" }));
  dialog = await screen.findByRole("dialog", {
    name: "Remove item from order?",
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Remove from order" }),
  );
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "removeOrderItem",
    itemId: "item",
    fingerprint: "current-totals",
    confirmed: true,
  });
});

it("opens Resolve in the main window and header back returns to lines", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    (await screen.findAllByRole("button", { name: "Resolve" }))[0]!,
  );
  expect(
    screen.getByRole("region", { name: "Resolve packing-slip line" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(posts).toEqual([]);
  runHeaderBackOverride();
  await screen.findByRole("region", { name: "Step 3: Line By Line Matching" });
  expect(
    screen.queryByRole("region", { name: "Resolve packing-slip line" }),
  ).toBeNull();
});

it("saves a Resolve correction for review without confirming or approving", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(
    (await screen.findAllByRole("button", { name: "Resolve" }))[0]!,
  );
  fireEvent.click(screen.getByRole("button", { name: "Correct the reading" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Save reading for review" }),
  );
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    action: "line",
    lineId: "0",
    checked: false,
  });
  expect(posts.some((p) => p.action === "approve")).toBe(false);
});

it("keeps unresolved absent-order-item notes in the review count", async () => {
  Object.assign(state.review, {
    orderResolutions: {
      absent: {
        disposition: "unresolved",
        note: "Ask supplier",
        by: "user",
        at: "now",
      },
    },
  });
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByText("2 still to review");
});

it("shows what's needed from Resolve on the line's row", async () => {
  Object.assign(state.review.lines[0]!, {
    note: { text: "Supplier to confirm the box size", by: "user", at: "now" },
  });
  render(<ReceivingWorkspace jobId="job" />);
  expect(
    await screen.findByText("Supplier to confirm the box size"),
  ).toBeInTheDocument();
});

// What the finger is over while dragging; jsdom does no layout.
let under: () => Element | null = () => null;
function dragSetup() {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => under(),
  });
  onTestFinished(() => {
    Reflect.deleteProperty(document, "elementFromPoint");
    under = () => null;
  });
  notOnOrder(3);
  state.items.push({
    ...state.items[0]!,
    id: "item2",
    description: "Copper pipe 1/2",
    ordered: 3,
    received: 0,
  });
  Object.assign(state, {
    correctionUndo: { requestId: "move-request", label: "Line" },
  });
  // The server pairs the line, so the comparison reloads with it moved.
  const serve = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, opts?: RequestInit) => {
      const res = await serve(url, opts);
      const last = posts.at(-1);
      if (opts?.method === "POST" && last?.action === "line")
        Object.assign(state.review.lines.find((l) => l.id === last.lineId)!, {
          orderItemId: last.orderItemId,
        });
      return res;
    }),
  );
}
const hold = () =>
  act(() => new Promise((done) => setTimeout(done, LONG_PRESS_MS + 50)));
it("moves a slip line onto an order item by long pressing and dragging, and the likely row goes with it", async () => {
  dragSetup();
  render(<ReceivingWorkspace jobId="job" />);
  expect(await screen.findByText(/Likely Copper pipe/)).toBeInTheDocument();
  const reading = screen.getByText("Unclear pipe").closest("[role=group]")!;
  const target = screen.getByRole("heading", { name: "Copper pipe 1/2" });
  under = () => target;
  fireEvent.touchStart(reading, { touches: [{ clientX: 200, clientY: 600 }] });
  await hold();
  // Lifted, but not dragged until it moves.
  expect(screen.queryByText(/Move to/)).not.toBeInTheDocument();
  fireEvent.touchMove(window, { touches: [{ clientX: 200, clientY: 300 }] });
  expect(screen.getByText("Move to Copper pipe 1/2")).toBeInTheDocument();
  const half = reading.closest<HTMLElement>("[data-drag-half]")!;
  expect(half.style.transform).toBe("translate(0px, -300px)");
  expect(half).toHaveClass("pointer-events-none");
  expect(screen.getAllByText("Unclear pipe")).toHaveLength(1);
  fireEvent.touchEnd(window, { touches: [] });
  expect(half.style.transform).toBe("");
  await waitFor(() =>
    expect(posts).toContainEqual(
      expect.objectContaining({
        action: "line",
        lineId: "1",
        orderItemId: "item2",
        quantity: 3,
        checked: false,
      }),
    ),
  );
  expect(posts.at(-1)).not.toHaveProperty("approved");
  expect(
    await screen.findByText("Moved to Copper pipe 1/2."),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Likely Copper pipe/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(posts.at(-1)).toMatchObject({
      action: "undoCorrection",
      requestIdToUndo: "move-request",
    }),
  );
});
it("a slip line shown beside its likely order item can be dropped there to link it", async () => {
  dragSetup();
  Object.assign(state, { pairs: { "1": "item2" } });
  render(<ReceivingWorkspace jobId="job" />);
  expect(
    await screen.findByText(/The slip line is likely this part/),
  ).toBeVisible();
  const reading = screen.getByText("Unclear pipe").closest("[role=group]")!;
  under = () => reading;
  fireEvent.touchStart(reading, { touches: [{ clientX: 200, clientY: 600 }] });
  await hold();
  fireEvent.touchMove(window, { touches: [{ clientX: 200, clientY: 590 }] });
  expect(screen.getByText("Move to Copper pipe 1/2")).toBeInTheDocument();
  fireEvent.touchEnd(window, { touches: [] });
  await waitFor(() =>
    expect(posts).toContainEqual(
      expect.objectContaining({
        action: "line",
        lineId: "1",
        orderItemId: "item2",
      }),
    ),
  );
});
it("scrolling past a slip line or tapping it never starts a drag", async () => {
  dragSetup();
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByText(/Likely Copper pipe/);
  const reading = screen.getByText("Unclear pipe").closest("[role=group]")!;
  under = () => screen.getByRole("heading", { name: "Copper pipe 1/2" });
  fireEvent.touchStart(reading, { touches: [{ clientX: 200, clientY: 600 }] });
  fireEvent.touchMove(window, { touches: [{ clientX: 200, clientY: 560 }] });
  await hold();
  fireEvent.touchEnd(window, { touches: [] });
  expect(screen.queryByText("Drop on an order item")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", {
      name: /View packing-slip line: Unclear pipe/,
    }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Packing-slip line" }),
  ).toBeInTheDocument();
  expect(posts).toEqual([]);
});
it("drags an order item onto a slip line to pair them", async () => {
  dragSetup();
  render(<ReceivingWorkspace jobId="job" />);
  const pipe = (
    await screen.findByRole("heading", { name: "Copper pipe 1/2" })
  ).closest("li")!;
  const order = within(pipe).getByRole("group", { name: "Order" });
  under = () => screen.getByText("Unclear pipe");
  fireEvent.touchStart(order, { touches: [{ clientX: 80, clientY: 300 }] });
  await hold();
  fireEvent.touchMove(window, { touches: [{ clientX: 120, clientY: 500 }] });
  expect(screen.getByText("Pair with Unclear pipe")).toBeInTheDocument();
  fireEvent.touchEnd(window, { touches: [] });
  await waitFor(() =>
    expect(posts).toContainEqual(
      expect.objectContaining({
        action: "line",
        lineId: "1",
        orderItemId: "item2",
        checked: false,
      }),
    ),
  );
  expect(
    await screen.findByText("Moved to Copper pipe 1/2."),
  ).toBeInTheDocument();
});
it("letting go of a held half opens its options", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  const valve = (await screen.findByRole("heading", { name: "Valve" })).closest(
    "li",
  )!;
  const reading = within(valve).getAllByRole("group", {
    name: / reading$/,
  })[0]!;
  fireEvent.touchStart(reading, { touches: [{ clientX: 300, clientY: 300 }] });
  await hold();
  fireEvent.touchMove(window, { touches: [{ clientX: 302, clientY: 303 }] });
  fireEvent.touchEnd(window, { touches: [] });
  expect(
    await screen.findByText("Drag onto an order item to pair them."),
  ).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "View on slip" })).toBeVisible();
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Split" }),
  );
  await waitFor(() =>
    expect(posts).toContainEqual(
      expect.objectContaining({
        action: "splitComparison",
        lineIds: ["0"],
      }),
    ),
  );
  expect(posts.at(-1)).not.toHaveProperty("approved");
});
it("says Empty on the side of a card with no match", async () => {
  state.items.push({
    ...state.items[0]!,
    id: "item-2",
    description: "Elbow",
    received: 0,
  });
  render(<ReceivingWorkspace jobId="job" />);
  const elbow = (await screen.findByRole("heading", { name: "Elbow" })).closest(
    "li",
  )!;
  expect(
    within(elbow).getByRole("group", { name: "Slip reading" }),
  ).toHaveTextContent(/^SlipEmpty/);
  const pipe = screen
    .getByRole("heading", { name: "Unclear pipe" })
    .closest("li")!;
  expect(within(pipe).getByRole("group", { name: "Order" })).toHaveTextContent(
    /^OrderEmptyNot on the order/,
  );
});
it("an order item dragged onto another slip line leaves the line it was paired with", async () => {
  dragSetup();
  state.review.lines[0]!.orderItemId = "item2";
  render(<ReceivingWorkspace jobId="job" />);
  const pipe = (
    await screen.findByRole("heading", { name: "Copper pipe 1/2" })
  ).closest("li")!;
  const order = within(pipe).getByRole("group", { name: "Order" });
  under = () => screen.getByText("Unclear pipe");
  fireEvent.touchStart(order, { touches: [{ clientX: 80, clientY: 300 }] });
  await hold();
  fireEvent.touchMove(window, { touches: [{ clientX: 120, clientY: 500 }] });
  fireEvent.touchEnd(window, { touches: [] });
  await waitFor(() =>
    expect(posts.filter((p) => p.action === "line")).toEqual([
      expect.objectContaining({ lineId: "1", orderItemId: "item2" }),
      expect.objectContaining({ lineId: "0", orderItemId: null }),
    ]),
  );
  expect(
    await screen.findByText("Paired with Unclear pipe. Valve unpaired."),
  ).toBeInTheDocument();
});

it("reopens a completed repeat-scan decision without changing it until saved", async () => {
  state.duplicates = [{ id: "old", name: "Earlier slip.jpg", reason: "Same delivery", key: "old:v1", received: false }] as typeof state.duplicates;
  Object.assign(state.review, {
    duplicateChecked: ["old:v1"],
    duplicateDecision: { action: "supporting", documentId: "old", reason: "Repeat", by: "user", at: "now" },
  });
  render(<ReceivingWorkspace jobId="job" />);
  const recheck = await screen.findByRole("button", { name: "Recheck" });
  expect(recheck).toBeEnabled();
  fireEvent.click(recheck);
  expect(await screen.findByRole("button", { name: "Different delivery" })).toBeEnabled();
  expect(posts).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(screen.queryByRole("button", { name: "Different delivery" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Recheck" }));
  fireEvent.click(await screen.findByRole("button", { name: "Different delivery" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ action: "duplicate", decision: "additional", otherDocumentId: "old" });
});

it("puts unresolved comparisons before received comparisons", async () => {
  state.review.lines[0]!.approved = { itemId: "item", quantity: 6, kind: "delivery", by: "receiver", at: "now" };
  render(<ReceivingWorkspace jobId="job" />);
  const unresolved = await screen.findByText("Unclear pipe");
  const received = screen.getByRole("heading", { name: "Valve" });
  expect(unresolved.compareDocumentPosition(received) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("button", { name: "Review resolution" })).toBeInTheDocument();
});

it("splits from the order half menu too", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  const card = (await screen.findByRole("heading", { name: "Valve" })).closest("li")!;
  const half = within(card).getByRole("group", { name: "Order" });
  fireEvent.touchStart(half, { touches: [{ clientX: 80, clientY: 300 }] });
  await hold();
  fireEvent.touchEnd(window, { touches: [] });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Split" }));
  await waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ action: "splitComparison", lineIds: ["0"] })));
});

it.each([['Keep material anyway?', 'supplier-keep'], ['Material needs to be returned.', 'supplier-return']])("records supplier entry choice: %s", async (label, decision) => {
  render(<ReceivingWorkspace jobId="job" />);
  const card = (await screen.findByRole("heading", { name: "Valve" })).closest("li")!;
  const half = within(card).getAllByRole("group", {name:/ reading$/})[0]!;
  fireEvent.touchStart(half, {touches:[{clientX:300,clientY:300}]});
  await hold();
  fireEvent.touchEnd(window,{touches:[]});
  expect(screen.getByRole("menuitem",{name:"Shipped Material Doesn’t Match Slip"})).toBeVisible();
  fireEvent.click(screen.getByRole("menuitem",{name:"Supplier Entered This Incorrectly"}));
  expect(posts).toEqual([]);
  fireEvent.click(await screen.findByRole("button",{name:label}));
  await waitFor(() => expect(posts).toContainEqual(expect.objectContaining({action:"resolve",lineId:"0",materialIssue:decision,delivery:"wrong",match:"unresolved",quantity:"unresolved"})));
  expect(posts.some(p => p.action === 'approve')).toBe(false);
});

it("records a shipped-material mismatch without approving quantities", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  const card = (await screen.findByRole("heading", { name: "Valve" })).closest("li")!;
  const half = within(card).getAllByRole("group", {name:/ reading$/})[0]!;
  fireEvent.touchStart(half, {touches:[{clientX:300,clientY:300}]});
  await hold();
  fireEvent.touchEnd(window,{touches:[]});
  fireEvent.click(screen.getByRole("menuitem",{name:"Shipped Material Doesn’t Match Slip"}));
  fireEvent.click(await screen.findByRole("button",{name:"Record mismatch"}));
  await waitFor(() => expect(posts).toContainEqual(expect.objectContaining({action:"resolve",lineId:"0",materialIssue:"shipped-mismatch",specification:"unresolved",delivery:"wrong"})));
});

it("marks linked halves with caution borders for a return, but not for kept material", async () => {
  Object.assign(state.review.lines[0]!, { resolution: { ...newResolution(state.review.lines[0]!, "user", "now"), materialIssue: "supplier-return" } });
  const view = render(<ReceivingWorkspace jobId="job" />);
  await screen.findByRole("heading", { name: "Valve" });
  expect(screen.getAllByRole("img", {name:"Material marked for return"})).toHaveLength(2);
  view.unmount();
  Object.assign(state.review.lines[0]!, { resolution: { ...newResolution(state.review.lines[0]!, "user", "now"), materialIssue: "supplier-keep" } });
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByRole("heading", { name: "Valve" });
  expect(screen.queryByRole("img", {name:"Material marked for return"})).not.toBeInTheDocument();
});

async function openSlipPartChooser() {
  const line = await screen.findByText("Unclear pipe");
  const reading = line.closest('[role="group"]')!;
  fireEvent.touchStart(reading, { touches: [{ clientX: 300, clientY: 300 }] });
  await hold();
  fireEvent.touchEnd(window, { touches: [] });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Add this part to material list" }));
  return screen.findByRole("dialog", { name: "Add this part to material list" });
}

it("offers the top three part cards and create instead from the slip menu", async () => {
  notOnOrder(3);
  const candidates = (state as typeof state & { likely: Record<string, Array<Record<string, unknown>>> }).likely["1"]!;
  const original = candidates[0]!;
  candidates.push(...[2, 3, 4].map(n => ({ ...original, id: `pipe-${n}`, name: `Pipe choice ${n}`, code: false })));
  render(<ReceivingWorkspace jobId="job" />);
  const dialog = await openSlipPartChooser();
  const choices = within(dialog).getByRole("list", { name: "Likely catalogue parts" });
  expect(within(choices).getAllByRole("listitem")).toHaveLength(4);
  expect(within(choices).getByRole("button", { name: /Create A Part Instead/ })).toBeVisible();
  expect(within(choices).queryByText("Pipe choice 4")).not.toBeInTheDocument();
  expect(posts).toEqual([]);
  fireEvent.click(within(choices).getByRole("button", { name: "Add Pipe choice 2 to the list" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({action: "part", lineId: "1", partId: "pipe-2", addToOrder: true});
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
});

it("opens a prefilled create form from the fourth card without saving until submitted", async () => {
  notOnOrder(3);
  state.review.lines[1]!.sku = "PIPE-123";
  state.review.lines[1]!.unit = "ft";
  Object.assign(state.review.lines[1]!, {unitPrice: 12.5});
  render(<ReceivingWorkspace jobId="job" />);
  const dialog = await openSlipPartChooser();
  fireEvent.click(within(dialog).getByRole("button", {name: /Create A Part Instead/}));
  expect(within(dialog).getByLabelText("Part name")).toHaveValue("Unclear pipe");
  expect(within(dialog).getByLabelText("Description")).toHaveValue("Unclear pipe");
  expect(within(dialog).getByLabelText("Order unit")).toHaveValue("ft");
  expect(within(dialog).getByText("Supplier code: PIPE-123")).toBeVisible();
  expect(within(dialog).getByText("Job unit price: 12.5")).toBeVisible();
  expect(posts).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", {name: "Add to ForemanHQ and the list"}));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({action:"part", lineId:"1", partId:null, name:"Unclear pipe", unit:"ft", addToOrder:true});
});

it("takes a missing-quantity line back to its editor instead of adding an uncounted part", async () => {
  notOnOrder(null);
  render(<ReceivingWorkspace jobId="job" />);
  const dialog = await openSlipPartChooser();
  expect(within(dialog).getByRole("button", {name:"Add Copper pipe to the list"})).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", {name:"Review quantity"}));
  expect(dialog).not.toBeInTheDocument();
  expect(screen.getByText("Enter the quantity that came below and save it first.")).toBeVisible();
  expect(posts).toEqual([]);
});

it("shows a rejected add inside the chooser and keeps the draft available", async () => {
  notOnOrder(3);
  const fetchNormally = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, opts) => opts?.method === "POST"
    ? Response.json({error: "A part with this name already exists. Search the catalogue and select it."}, {status:409})
    : fetchNormally(url, opts));
  render(<ReceivingWorkspace jobId="job" />);
  const dialog = await openSlipPartChooser();
  fireEvent.click(within(dialog).getByRole("button", {name:/Create A Part Instead/}));
  fireEvent.click(within(dialog).getByRole("button", {name:"Add to ForemanHQ and the list"}));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("A part with this name already exists");
  expect(within(dialog).getByLabelText("Part name")).toHaveValue("Unclear pipe");
  expect(dialog).toBeVisible();
});

it("does not offer adding parts to a reviewer without creation permission", async () => {
  notOnOrder(3);
  state.canCreate = false;
  render(<ReceivingWorkspace jobId="job" />);
  const line = await screen.findByText("Unclear pipe");
  fireEvent.touchStart(line.closest('[role="group"]')!, {touches:[{clientX:300,clientY:300}]});
  await hold();
  fireEvent.touchEnd(window, {touches:[]});
  expect(await screen.findByRole("menuitem", {name:"View on slip"})).toBeVisible();
  expect(screen.queryByRole("menuitem", {name:"Add this part to material list"})).not.toBeInTheDocument();
});
it.each([10, 9, null])("only offers Accept With Backorder when printed BO accounts for the full shortage (%s)", async (bo) => {
  state.items[0]!.received = 0;
  state.review.lines[0]!.quantity = 0;
  Object.assign(state.review, { analysisRunId: "run" });
  Object.assign(state.review.lines[0]!, { sourceIndex: 0 });
  Object.assign(state.document.packingSlipAnalysis, { lines: [{
    page: 1, evidence: "Valve ordered 10 shipped 0 BO", ordered: 10,
    shipped: 0, backordered: bo, unit: "ea", orderItemId: "item",
    source: "terra", issues: [], proposed: null,
  }] });
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByRole("heading", { name: "Valve" });
  const backorder = screen.queryByText("Backordered", {selector:"dt"});
  if (bo == null) expect(backorder).toBeNull();
  else {
    expect(backorder?.nextElementSibling).toHaveTextContent(String(bo));
    expect(backorder?.parentElement?.querySelectorAll("dt")[1]).toHaveTextContent("Received");
    expect(screen.queryByText(/accounts for the shortage/)).not.toBeInTheDocument();
  }
  const accept = screen.queryByRole("button", { name: "Accept With Backorder" });
  if (bo !== 10) { expect(accept).toBeNull(); return; }
  expect(accept).toBeEnabled();
  fireEvent.click(accept!);
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ action: "resolve", lineId: "0",
    delivery: "short", siteQuantity: 0, acceptedQuantity: 0,
    remainder: "backordered", match: "confirmed", quantity: "confirmed" });
  expect(state.items[0]!.received).toBe(0);
});
it("uses the same confirmation action with standard wording for a matching delivery", async () => {
  state.items[0]!.received = 0;
  state.items[0]!.ordered = 6;
  state.review.lines[0]!.ordered = 6;
  render(<ReceivingWorkspace jobId="job" />);
  const confirm = await screen.findByRole("button", { name: "Accept" });
  expect(screen.queryByRole("button", { name: "Accept With Backorder" })).toBeNull();
  fireEvent.click(confirm);
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ action: "resolve", lineId: "0", delivery: "confirmed", siteQuantity: 6, acceptedQuantity: 6 });
  expect(state.items[0]!.received).toBe(0);
});

it("prefills an explicitly stated package size when the slip is counted in boxes", async () => {
  notOnOrder(2);
  state.review.lines[1]!.description = "Screws — box of 100";
  state.review.lines[1]!.unit = "box";
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(await screen.findByRole("button", {name:"Review line: Screws — box of 100"}));
  fireEvent.click(screen.getByRole("button", {name:"New part in ForemanHQ"}));
  expect(screen.getByLabelText("Pieces per pack (if packaged)")).toHaveValue(100);
  expect(screen.getByLabelText("Order unit")).toHaveValue("box");
  expect(screen.getByLabelText("Individual unit")).toHaveValue("ea");
  expect(posts).toEqual([]);
});

// Accept plays its wave on a canvas; with reduced
// motion it saves and shows the check straight away.
function confirmSetup(
  apply: (body: Record<string, unknown>) => boolean = () => true,
) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
  const serve = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        const body = JSON.parse(
          typeof opts.body === "string" ? opts.body : "{}",
        ) as Record<string, unknown>;
        if (!apply(body)) {
          posts.push(body);
          return Response.json({ error: "Could not save." }, { status: 500 });
        }
        if (body.action === "line")
          Object.assign(state.review.lines.find((l) => l.id === body.lineId)!, {
            orderItemId: body.orderItemId,
            quantity: body.quantity,
            checked: body.checked === true,
          });
        if (body.action === "resolve") {
          const line = state.review.lines.find((l) => l.id === body.lineId)!;
          const resolution: Record<string, unknown> = {
            ...newResolution(line as ReceivingLine, "receiver", "now"),
          };
          for (const [key, value] of Object.entries(body))
            if (!["action", "lineId", "evidenceFingerprint"].includes(key))
              resolution[key] = value;
          Object.assign(line, { checked: true, resolution });
        }
        if (body.action === "orderDisposition")
          Object.assign(state.review, {
            orderResolutions: {
              [body.itemId as string]: {
                disposition: body.disposition,
                note: "",
                by: "receiver",
                at: "now",
              },
            },
          });
      }
      return serve(url, opts);
    }),
  );
}
const confirmButton = (row: HTMLElement) =>
  within(row).queryByRole("button", { name: "Accept" });
it("accepts a matching comparison with the animated button", async () => {
  confirmSetup();
  state.items[0]!.received = 0;
  state.items[0]!.ordered = 6;
  state.review.lines[0]!.ordered = 6;
  render(<ReceivingWorkspace jobId="job" />);
  const row = (await screen.findByRole("heading", { name: "Valve" })).closest(
    "li",
  )!;
  const circle = () => row.querySelector("[data-comparison-state]")!;
  expect(circle()).toHaveAttribute("data-comparison-state", "pending");
  // One button per row, not a second plain Accept beside it.
  expect(within(row).getAllByRole("button", { name: "Accept" })).toHaveLength(1);
  fireEvent.click(confirmButton(row)!);
  await waitFor(() =>
    expect(circle()).toHaveAttribute("data-comparison-state", "complete"),
  );
  expect(posts).toEqual([
    expect.objectContaining({
      action: "resolve",
      lineId: "0",
      delivery: "confirmed",
      siteQuantity: 6,
      acceptedQuantity: 6,
    }),
  ]);
  expect(
    await screen.findByText("Information confirmed. Ready for final approval."),
  ).toBeInTheDocument();
  await waitFor(() => expect(confirmButton(row)).not.toBeInTheDocument());
  expect(state.review.lines[0]!.approved).toBeUndefined();
});
it("offers Accept only when it settles the row", async () => {
  confirmSetup();
  render(<ReceivingWorkspace jobId="job" />);
  // 6 of the 8 still due, and a line with no quantity.
  const valve = (await screen.findByRole("heading", { name: "Valve" })).closest(
    "li",
  )!;
  expect(confirmButton(valve)).not.toBeInTheDocument();
  const pipe = screen
    .getByRole("heading", { name: "Unclear pipe" })
    .closest("li")!;
  expect(confirmButton(pipe)).not.toBeInTheDocument();
});
it("links a slip line shown beside its likely order item when confirmed", async () => {
  confirmSetup();
  notOnOrder(3);
  state.items.push({
    ...state.items[0]!,
    id: "item2",
    description: "Copper pipe 1/2",
    ordered: 3,
    received: 0,
  });
  Object.assign(state, { pairs: { "1": "item2" } });
  render(<ReceivingWorkspace jobId="job" />);
  const row = (
    await screen.findByRole("heading", { name: "Copper pipe 1/2" })
  ).closest("li")!;
  fireEvent.click(confirmButton(row)!);
  await waitFor(() =>
    expect(row.querySelector("[data-comparison-state]")).toHaveAttribute(
      "data-comparison-state",
      "complete",
    ),
  );
  expect(posts).toEqual([
    expect.objectContaining({
      action: "line",
      lineId: "1",
      orderItemId: "item2",
      checked: true,
    }),
  ]);
});
it("confirms an order item with nothing on the slip as still due, and it keeps its place", async () => {
  confirmSetup();
  state.items.push({
    ...state.items[0]!,
    id: "item-2",
    description: "Elbow",
    received: 0,
  });
  render(<ReceivingWorkspace jobId="job" />);
  const elbow = (await screen.findByRole("heading", { name: "Elbow" })).closest(
    "li",
  )!;
  fireEvent.click(confirmButton(elbow)!);
  await waitFor(() =>
    expect(elbow.querySelector("[data-comparison-state]")).toHaveAttribute(
      "data-comparison-state",
      "complete",
    ),
  );
  expect(posts).toEqual([
    expect.objectContaining({
      action: "orderDisposition",
      itemId: "item-2",
      disposition: "outstanding",
    }),
  ]);
  // Still above the slip line that needs work.
  const pipe = screen.getByRole("heading", { name: "Unclear pipe" });
  expect(
    screen
      .getByRole("heading", { name: "Elbow" })
      .compareDocumentPosition(pipe) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    within(
      screen.getByRole("heading", { name: "Elbow" }).closest("li")!,
    ).getByRole("group", { name: "Slip reading" }),
  ).toHaveTextContent(/^Slip/);
});
it("brings Accept back when the save fails", async () => {
  confirmSetup(() => false);
  state.items[0]!.received = 0;
  state.items[0]!.ordered = 6;
  state.review.lines[0]!.ordered = 6;
  render(<ReceivingWorkspace jobId="job" />);
  const row = (await screen.findByRole("heading", { name: "Valve" })).closest(
    "li",
  )!;
  fireEvent.click(confirmButton(row)!);
  expect(await screen.findByText("Could not save.")).toBeInTheDocument();
  await waitFor(() => expect(confirmButton(row)).toBeEnabled());
  expect(confirmButton(row)).toBeVisible();
  expect(row.querySelector("[data-comparison-state]")).toHaveAttribute(
    "data-comparison-state",
    "pending",
  );
});

it("Modify reverses pair acceptance without unlinking the part or receiving quantities", async () => {
  confirmSetup(body => {
    if (body.action === "resolve") {
      const line = state.review.lines.find(l => l.id === body.lineId)!;
      Object.assign(line, {checked:false, resolution:{...newResolution(line as ReceivingLine,"receiver","now"), counterpartFingerprint:body.counterpartFingerprint}});
    }
    return true;
  });
  state.review.lines[0]!.quantity = 8;
  // No printed ordered column, so no BO check holds Accept back.
  state.review.lines[0]!.ordered = null;
  render(<ReceivingWorkspace jobId="job" />);
  const row = (await screen.findByRole("heading", {name:"Valve"})).closest("li")!;
  fireEvent.click(confirmButton(row)!);
  await waitFor(() => expect(confirmButton(row)).not.toBeInTheDocument());
  const half = within(row).getAllByRole("group", {name:/ reading$/})[0]!;
  fireEvent.touchStart(half, {touches:[{clientX:300,clientY:300}]});
  await hold();fireEvent.touchEnd(window, {touches:[]});
  fireEvent.click(await screen.findByRole("menuitem", {name:"Modify"}));
  await waitFor(() => expect(row.querySelector("[data-comparison-state]")).toHaveAttribute("data-comparison-state","pending"));
  expect(confirmButton(row)).toBeVisible();
  expect(posts.at(-1)).toMatchObject({action:"resolve",lineId:"0",match:"unresolved",specification:"unresolved",quantity:"unresolved",delivery:"unresolved"});
  expect(state.review.lines[0]!.orderItemId).toBe("item");
  expect(state.review.lines[0]!.quantity).toBe(8);
  expect(state.items[0]!.received).toBe(2);
  expect(posts.some(p => p.action === "approve")).toBe(false);
});

it("Modify reopens an accepted order-only pair and allows accepting it again", async () => {
  confirmSetup();
  state.items.push({...state.items[0]!,id:"item-2",description:"Elbow",received:0});
  render(<ReceivingWorkspace jobId="job" />);
  const row = (await screen.findByRole("heading", {name:"Elbow"})).closest("li")!;
  fireEvent.click(confirmButton(row)!);
  await waitFor(() => expect(confirmButton(row)).not.toBeInTheDocument());
  fireEvent.touchStart(within(row).getByRole("group", {name:"Order"}), {touches:[{clientX:80,clientY:300}]});
  await hold();fireEvent.touchEnd(window, {touches:[]});
  fireEvent.click(await screen.findByRole("menuitem", {name:"Modify"}));
  await waitFor(() => expect(confirmButton(row)).toBeVisible());
  expect(posts.at(-1)).toMatchObject({action:"orderDisposition",itemId:"item-2",disposition:"unresolved"});
  fireEvent.click(confirmButton(row)!);
  await waitFor(() => expect(posts.at(-1)).toMatchObject({action:"orderDisposition",itemId:"item-2",disposition:"outstanding"}));
});

it("opens slip options by holding the empty left card", async () => {
  notOnOrder(3);
  render(<ReceivingWorkspace jobId="job" />);
  const row = (await screen.findByRole("heading", {name:"Unclear pipe"})).closest("li")!;
  fireEvent.touchStart(within(row).getByRole("group", {name:"Order"}), {touches:[{clientX:80,clientY:300}]});
  await hold();fireEvent.touchEnd(window, {touches:[]});
  expect(await screen.findByRole("menuitem", {name:"View on slip"})).toBeVisible();
  fireEvent.click(screen.getByRole("menuitem", {name:"Add this part to material list"}));
  expect(await screen.findByRole("dialog", {name:"Add this part to material list"})).toBeVisible();
  expect(posts).toEqual([]);
});

it("confirms not-an-item removal and hides only that detection without receiving anything", async () => {
  notOnOrder(3);
  const serve = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts?: RequestInit) => {
    if (opts?.method === "POST") {
      const body = JSON.parse(String(opts.body));
      if (body.action === "ignore") Object.assign(state.review.lines.find(line => line.id === body.lineId)!, {ignored:{reason:body.reason,by:"receiver",at:"now"}});
    }
    return serve(url,opts);
  }));
  render(<ReceivingWorkspace jobId="job" />);
  const open = async () => {
    const row = (await screen.findByRole("heading", {name:"Unclear pipe"})).closest("li")!;
    fireEvent.touchStart(within(row).getByRole("group", {name:"Order"}), {touches:[{clientX:80,clientY:300}]});
    await hold();fireEvent.touchEnd(window, {touches:[]});
    fireEvent.click(await screen.findByRole("menuitem", {name:"This is not an item"}));
    return screen.findByRole("dialog", {name:"This is not an item?"});
  };
  let dialog = await open();
  expect(posts).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", {name:"Cancel"}));
  expect(screen.getByRole("heading", {name:"Unclear pipe"})).toBeVisible();
  expect(posts).toEqual([]);
  dialog = await open();
  fireEvent.click(within(dialog).getByRole("button", {name:"Remove item"}));
  await waitFor(() => expect(screen.queryByRole("heading", {name:"Unclear pipe"})).not.toBeInTheDocument());
  expect(posts).toEqual([expect.objectContaining({action:"ignore",lineId:"1",reason:"This is not an item"})]);
  expect(state.items[0]!.received).toBe(2);
  expect(state.review.lines).toHaveLength(2);
});
