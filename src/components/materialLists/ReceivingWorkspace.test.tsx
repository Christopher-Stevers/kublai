import type { ReceivingLine } from "~/lib/receiving-review";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ReceivingWorkspace } from "./ReceivingWorkspace";
import { runHeaderBackOverride } from "~/lib/header-back-events";
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
  SlipLineImage: ({page, box, initiallyZoomed}: {page: number; box: unknown; initiallyZoomed?: boolean}) =>
    <div role="img" aria-label={`Slip crop page ${page}`} data-box={JSON.stringify(box)} data-zoomed={String(initiallyZoomed)} />,
}));
vi.mock("~/hooks/use-replicache-material-list", () => ({
  useReplicacheMaterialList: () => ({items: [], materialList: null}),
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
  expect(screen.getByRole("link", { name: "View source" })).toHaveAttribute(
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
it("opens the slip in the documents viewer from step 3", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  const step = await screen.findByRole("region", {
    name: "Step 3: Line By Line Matching",
  });
  expect(within(step).getByRole("link", { name: "View slip" })).toHaveAttribute(
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
    name: "Step 2: Match Order",
  });
  expect(order).toHaveTextContent("Matched order");
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
  fireEvent.click(await screen.findByRole("button", { name: "Review line: Valve" }));
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
    name: "Step 1: Duplicate check",
  });
  expect(check).toHaveTextContent("This slip may have been scanned before.");
  expect(check).toHaveTextContent("Earlier slip.jpg");
  expect(check).toHaveTextContent("It has already been received.");
  expect(
    screen.getByRole("region", { name: "Step 2: Match Order" }),
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
  ).toEqual(["Valve", "Elbow", "No matching part"]);
  const valve = screen.getByRole("heading", { name: "Valve" }).closest("li")!;
  expect(valve).toHaveTextContent("ValveOrdered10Received28 still due");
  const terra = within(valve).getByRole("group", { name: "Terra 6.1 reading" });
  expect(terra).toHaveTextContent("98%");
  expect(terra).toHaveTextContent("Received6");
  expect(terra).toHaveTextContent("2 short");
  const elbow = screen.getByRole("heading", { name: "Elbow" }).closest("li")!;
  expect(elbow).toHaveTextContent("4 still due");
  expect(elbow).toHaveTextContent("Not on the slip");
  const pipe = screen
    .getByRole("heading", { name: "Unclear pipe" })
    .closest("li")!;
  expect(pipe).toHaveTextContent("Not on the order");
  expect(pipe).toHaveTextContent("Not read");
  fireEvent.click(screen.getByRole("button", { name: "Review line: Unclear pipe" }));
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
  fireEvent.click(await screen.findByRole("button", { name: /^Review line: HEX NUT GR2/ }));
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
  fireEvent.click(await screen.findByRole("button", { name: /^Review line: HEX NUT GR2/ }));
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
  expect(screen.queryByRole("button", { name: "Refresh receiving queue" })).not.toBeInTheDocument();
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
      .getAllByRole("group")
      .map((g) => g.textContent);
  // The most confident reader first; the others behind one toggle.
  expect(readers()).toEqual(["Terra 6.197%ValveOrdered—Received62 short2 other readers"]);
  fireEvent.click(within(valve).getByRole("button", { name: /2 other readers/ }));
  expect(readers()).toEqual([
    "Terra 6.197%ValveOrdered—Received62 shortHide other readers",
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
  expect(
    within(pipe).getByRole("group", { name: "Jev Image reading" }),
  ).toHaveTextContent(
    "Jev Image63%Unclear pipeOrdered—ReceivedNot read",
  );
  expect(pipe).toHaveTextContent("Terra 6.1 found no product here");
  fireEvent.click(screen.getByRole("button", { name: "Review line: Unclear pipe" }));
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
  await screen.findByText("Suggested order", {}, { timeout: 6000 });
  expect(screen.getByText("PO-155")).toBeInTheDocument();
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
it("adds the likely catalogue part to the material list in one tap", async () => {
  notOnOrder(3);
  render(<ReceivingWorkspace jobId="job" />);
  expect(await screen.findByText(/Likely Copper pipe/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review line: Unclear pipe" }));
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
  Object.assign((state as typeof state & { likely: Record<string, Array<Record<string, unknown>>> }).likely["1"]![0]!, {
    unit: "length", piecesPerPack: 12, individualUnit: "ft",
  });
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(await screen.findByRole("button", { name: "Review line: Unclear pipe" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Copper pipe to the list" }));
  const dialog = await screen.findByRole("dialog", { name: "Confirm what “each” means" });
  expect(dialog).toHaveTextContent("one length contains 12 ft");
  expect(dialog).toHaveTextContent("Delivered: 1 length");
  expect(posts).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(posts).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Add Copper pipe to the list" }));
  fireEvent.click(screen.getByRole("button", { name: "Yes, add as length" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ action: "part", partId: "pipe", unit: "length", piecesPerPack: 12, packageUnitConfirmed: true });
});
it("adds a new part to ForemanHQ and the material list together", async () => {
  notOnOrder(3);
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(await screen.findByRole("button", { name: "Review line: Unclear pipe" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Review line: Unclear pipe" }));
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
      const body = JSON.parse(typeof opts.body === "string" ? opts.body : "{}") as Record<string, unknown>;
      if (body.action === "line")
        Object.assign(state.review.lines[0]!, { checked: body.checked === true });
    }
    return originalFetch(url, opts);
  });
  render(<ReceivingWorkspace jobId="job" />);
  const row = (await screen.findByRole("heading", { name: "Valve" })).closest("li")!;
  const circle = () => row.querySelector("[data-comparison-state]")!;
  expect(circle()).toHaveAttribute("data-comparison-state", "pending");
  fireEvent.click(within(row).getByRole("button", { name: "Review line: Valve" }));
  fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
  await waitFor(() => expect(circle()).toHaveAttribute("data-comparison-state", "complete"));
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
    expect(heading.closest("li")!.querySelector("[data-comparison-state]")).toHaveAttribute("data-comparison-state", "pending");
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
