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

it("saves a scan and opens its durable review without waiting for detection", async () => {
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    expect(options?.body).toBeInstanceOf(FormData);
    return Response.json({
      documentId: "doc",
      queued: true,
      orders: [],
      candidates: [],
      match: null,
    });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Scan Slip" }));
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("/jobs/job/receiving?document=doc"),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("opens a saved slip in the same shared review", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        slips: [
          {
            id: "saved",
            name: "Saved slip.pdf",
            createdAt: "2026-10-26",
            packingSlip: {
              orderId: "order",
              orderNumber: "PO-155",
              materialListId: "list",
              materialListName: "List",
            },
            status: "applied",
          },
        ],
      }),
    ),
  );
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Scan Slip" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Choose a saved slip instead" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Saved slip.pdf/ }),
  );
  expect(push).toHaveBeenCalledWith("/jobs/job/receiving?document=saved");
});
it("keeps a failed upload visible and never navigates as though it succeeded", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "Upload interrupted" }, { status: 503 }),
    ),
  );
  render(<ScanSlipButton jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Scan Slip" }));
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  await screen.findByText("Upload interrupted");
  expect(push).not.toHaveBeenCalled();
});
