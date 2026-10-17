import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PackingSlips } from "./PackingSlips";
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("uploads a camera image with its order and lists the saved document without marking items received", async () => {
  let saved = false;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      expect(url).toBe("/api/job-documents/upload?jobId=job");
      expect((options.body as FormData).get("packingSlipOrderId")).toBe(
        "order",
      );
      expect((options.body as FormData).get("file")).toBeInstanceOf(File);
      saved = true;
      return Response.json({ success: true });
    }
    return Response.json({
      canUpload: true,
      documents: saved
        ? [
            {
              id: "doc",
              name: "Packing slip - PO-123.jpg",
              createdAt: "2026-10-17",
              packingSlip: {
                orderId: "order",
                materialListId: "list",
                orderNumber: "PO-123",
              },
            },
          ]
        : [],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByRole("button", { name: "Take photo" });
  const camera = screen.getByLabelText("Photograph packing slip");
  expect(camera).toHaveAttribute("capture", "environment");
  fireEvent.change(camera, {
    target: {
      files: [new File(["photo"], "photo.jpg", { type: "image/jpeg" })],
    },
  });
  expect(
    await screen.findByRole("link", { name: /Packing slip - PO-123/ }),
  ).toHaveAttribute("href", "/dashboard/jobs/job/documents?document=doc");
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
});
it("retains a failed photo for retry and offers read-only slips from a normal material list", async () => {
  let fail = true;
  const fetcher = vi.fn(async (_: string, options?: RequestInit) =>
    options?.method === "POST"
      ? Response.json(
          fail ? { error: "Storage unavailable" } : { success: true },
          { status: fail ? 500 : 200 },
        )
      : Response.json({ canUpload: true, documents: [] }),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <PackingSlips jobId="job" materialListId="list" orderId="order" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByRole("button", { name: "Take photo" });
  fireEvent.change(screen.getByLabelText("Upload packing slip"), {
    target: { files: [new File(["photo"], "photo.jpg")] },
  });
  await screen.findByText("Storage unavailable");
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));
  await waitFor(() =>
    expect(screen.queryByText("Storage unavailable")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(2),
  );
  view.unmount();
  render(<PackingSlips jobId="job" materialListId="list" />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByText(/Open Verify Order/);
  expect(
    screen.queryByRole("button", { name: "Take photo" }),
  ).not.toBeInTheDocument();
});
