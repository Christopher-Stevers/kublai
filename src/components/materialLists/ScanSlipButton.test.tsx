import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ScanSlipButton } from "./ScanSlipButton";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: vi.fn() }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function Scanner({ onSave }: { onSave: (file: File) => Promise<boolean> }) {
      return (
        <button
          onClick={() =>
            void onSave(
              new File(["scan"], "Packing slip.pdf", {
                type: "application/pdf",
              }),
            )
          }
        >
          Done
        </button>
      );
    },
}));
afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});
const order = (id: string, orderNumber: string, list = "Level 3") => ({
  id,
  orderNumber,
  supplier: orderNumber.split("-")[1] ?? null,
  materialListId: `list-${id}`,
  materialListName: list,
  sentAt: "2026-10-20T00:00:00.000Z",
  received: false,
});
const orders = [
  order("o1", "174-Fastening House"),
  order("o2", "175-Next"),
  order("o3", "163-Next", "Level 2"),
];
const linked = (orderId: string) =>
  Response.json({
    documentId: "doc",
    orderId,
    materialListId: `list-${orderId}`,
  });

it("scans a slip, finds its order and opens its material list to check it", async () => {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.body instanceof FormData) {
      expect(url).toBe("/api/job-documents/packing-slips/find?jobId=job");
      expect(options.body.get("file")).toBeInstanceOf(File);
      return Response.json({
        documentId: "doc",
        match: "o1",
        candidates: ["o1", "o2"],
        orders,
      });
    }
    expect(JSON.parse(options?.body as string)).toEqual({
      action: "link",
      jobId: "job",
      documentId: "doc",
      orderId: "o1",
    });
    return linked("o1");
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Scan Slip" }));
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  expect(await screen.findByText("Matched to")).toBeTruthy();
  expect(screen.getByText("174-Fastening House")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Read slip now/ }));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("/jobs/material-lists/list-o1"),
  );
});

it("lets the member choose the order when the slip is not a clear match", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.body instanceof FormData)
        return Response.json({
          documentId: "doc",
          match: null,
          candidates: ["o2"],
          orders,
        });
      expect(options?.body).toContain(`"orderId":"o3"`);
      return linked("o3");
    }),
  );
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Scan Slip" }));
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  expect(await screen.findByText("Which order is this slip for?")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /175-Next.*closest/ }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show all 3 orders" }));
  fireEvent.click(screen.getByRole("button", { name: /163-Next/ }));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("/jobs/material-lists/list-o3"),
  );
});

it("opens a saved slip that already has an order, and matches one that does not", async () => {
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options?.method)
      return Response.json({
        slips: [
          {
            id: "linked",
            name: "Packing slip - 175-Next.pdf",
            createdAt: "2026-10-21T00:00:00.000Z",
            packingSlip: {
              orderId: "o2",
              materialListId: "list-o2",
              orderNumber: "175-Next",
              materialListName: "Level 3",
            },
            status: "ready",
          },
          {
            id: "loose",
            name: "Packing slip - unmatched 2026-10-22.pdf",
            createdAt: "2026-10-22T00:00:00.000Z",
            packingSlip: null,
            status: null,
          },
        ],
      });
    expect(JSON.parse(options.body as string)).toEqual({
      action: "identify",
      jobId: "job",
      documentId: "loose",
    });
    return Response.json({
      documentId: "loose",
      match: "o1",
      candidates: ["o1"],
      orders,
    });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Scan Slip" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Choose a saved slip instead" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /unmatched/ }));
  expect(await screen.findByText("Matched to")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Choose another order" }));
  expect(screen.getByText("Which order is this slip for?")).toBeTruthy();
  // Back to the list: a slip with an order opens straight away.
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Scan Slip" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Choose a saved slip instead" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /175-Next\.pdf/ }));
  expect(push).toHaveBeenCalledWith("/jobs/material-lists/list-o2");
});

it("hands the linked slip back when scanned from a material list", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) =>
      options?.body instanceof FormData
        ? Response.json({
            documentId: "doc",
            match: "o1",
            candidates: ["o1"],
            orders,
          })
        : linked("o1"),
    ),
  );
  const onLinked = vi.fn();
  render(<ScanSlipButton jobId="job" onLinked={onLinked} />);
  fireEvent.click(screen.getByRole("button", { name: "Scan Slip" }));
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  fireEvent.click(await screen.findByRole("button", { name: /Read slip now/ }));
  await waitFor(() => expect(onLinked).toHaveBeenCalledWith("list-o1", "o1"));
  expect(push).not.toHaveBeenCalled();
});
