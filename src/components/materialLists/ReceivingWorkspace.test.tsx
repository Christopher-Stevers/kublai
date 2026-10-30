import type { ReceivingLine } from "~/lib/receiving-review";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
      packingSlip: { orderId: "order", orderNumber: "PO-155" },
      packingSlipAnalysis: {
        progress: undefined as SlipAnalysis["progress"],
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
  fireEvent.click(screen.getByRole("button", { name: "View source" }));
  expect(screen.getByText("Source PDF")).toBeInTheDocument();
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
it("keeps actual processing visible and lets the member hide it", async () => {
  state.document.packingSlipAnalysis.status = "processing";
  state.document.packingSlipAnalysis.progress = {
    stage: "extracting",
    message: "Reading the scanned pages…",
  };
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByText("Reading the scanned pages…");
  fireEvent.click(screen.getByRole("button", { name: "Hide progress" }));
  expect(
    screen.queryByText("Reading the scanned pages…"),
  ).not.toBeInTheDocument();
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
    screen.getByRole("region", { name: "Step 3: Compare lines" }),
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
it("lists lines to review first and confirms a line as checked", async () => {
  render(<ReceivingWorkspace jobId="job" />);
  await screen.findByRole("heading", { name: "Valve" });
  expect(
    screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
  ).toEqual(["Unclear pipe", "Valve"]);
  fireEvent.click(screen.getByRole("button", { name: "Unclear pipe" }));
  expect(screen.getByText("Quantity unclear")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm line" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Valve" }));
  expect(screen.queryByText("Quantity unclear")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Confirm line" }));
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
