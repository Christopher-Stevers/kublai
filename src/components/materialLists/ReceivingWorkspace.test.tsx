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
const push = vi.fn();
const navigation = vi.hoisted(() => ({ query: "document=doc" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/components/jobs/documents/DocumentPdfPreview", () => ({
  DocumentPdfPreview: () => <div>Source PDF</div>,
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
it("opens the slip in the documents viewer from step 3", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  const step = await screen.findByRole("region", {
    name: "Step 3: Compare with the order",
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
  fireEvent.click(screen.getByRole("button", { name: "Confirm details" }));
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
  const order = await screen.findByRole("region", { name: "Step 2: Order" });
  expect(order).toHaveTextContent("Matched order");
  expect(order).toHaveTextContent("PO-155");
  expect(
    screen.getByRole("region", { name: "Step 3: Compare with the order" }),
  ).toHaveTextContent("After the order is confirmed.");
  expect(screen.queryByRole("heading", { name: "Valve" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Yes, this order" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Valve" }));
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
    screen.getByRole("region", { name: "Step 2: Order" }),
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
  });
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByRole("heading", { name: "Valve" });
  expect(
    screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
  ).toEqual(["Valve", "Elbow", "Unclear pipe"]);
  const valve = screen.getByRole("heading", { name: "Valve" }).closest("li")!;
  expect(valve).toHaveTextContent("Needs 8 ea");
  expect(valve).toHaveTextContent("6 ea");
  expect(valve).toHaveTextContent("2 ea short");
  expect(valve).toHaveTextContent("Terra 6.1 · 6 ea");
  expect(valve).toHaveTextContent("part 99%");
  expect(valve).toHaveTextContent("qty 97%");
  const elbow = screen.getByRole("heading", { name: "Elbow" }).closest("li")!;
  expect(elbow).toHaveTextContent("Needs 4 ea");
  expect(elbow).toHaveTextContent("Not on the slip");
  const pipe = screen
    .getByRole("heading", { name: "Unclear pipe" })
    .closest("li")!;
  expect(pipe).toHaveTextContent("Not on the order");
  expect(pipe).toHaveTextContent("Not read");
  fireEvent.click(screen.getByRole("button", { name: "Unclear pipe" }));
  expect(
    screen.getByText("The reading is unsure. Check it against the slip."),
  ).toBeInTheDocument();
  expect(screen.getByText("Quantity unclear")).not.toBeVisible();
  expect(screen.getByLabelText("Quantity")).toHaveValue(null);
  expect(
    screen.getByRole("button", { name: "Save and confirm" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Valve" }));
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

it("puts suggested order matches first and can restore newest-first order", async () => {
  navigation.query = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        documents: [
          {
            id: "new",
            name: "New unresolved slip",
            createdAt: "2026-10-27",
            status: "review",
            pending: 1,
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
          },
        ],
      }),
    ),
  );
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByText("Older suggested slip");
  const names = () =>
    screen
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter(
        (t) => t?.includes("unresolved slip") || t?.includes("suggested slip"),
      );
  expect(names()[0]).toContain("Older suggested slip");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Suggested order matches first" }),
  );
  expect(names()[0]).toContain("New unresolved slip");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search packing slips" }),
    { target: { value: "Older" } },
  );
  expect(screen.queryByText("New unresolved slip")).not.toBeInTheDocument();
  expect(
    screen.getByText("Suggested order match · needs confirmation"),
  ).toBeInTheDocument();
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
  const readers = [
    ...valve.querySelectorAll('[aria-label="Readers"] > li'),
  ].map((li) => li.textContent);
  expect(readers).toEqual([
    "OCR only · 5 eapart 40%qty 55%",
    "Jev Image · 6 eapart 90%qty 70%",
    "Terra 6.1 · 6 eapart 98%qty 96%",
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
  expect(pipe).toHaveTextContent("Jev Image · ? eapart 63%qty 63%");
  expect(pipe).toHaveTextContent("Terra 6.1 · found no product here");
  fireEvent.click(screen.getByRole("button", { name: "Unclear pipe" }));
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
    screen.getByRole("button", { name: "Yes, this order" }),
  ).toBeDisabled();
  expect(screen.queryByText(/lines? ready to approve/)).not.toBeInTheDocument();
  state.document.packingSlipAnalysis.status = "ready";
  await screen.findByText("Order confirmation required", {}, { timeout: 6000 });
  expect(posts).toEqual([]);
  expect(
    screen.getByRole("button", { name: "Review & approve" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Yes, this order" }));
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
  expect(await screen.findByText(/likely Copper pipe/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Unclear pipe" }));
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
it("adds a new part to ForemanHQ and the material list together", async () => {
  notOnOrder(3);
  render(<ReceivingWorkspace jobId="job" />);
  fireEvent.click(await screen.findByRole("button", { name: "Unclear pipe" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Unclear pipe" }));
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
