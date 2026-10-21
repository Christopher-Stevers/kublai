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
vi.mock("next/dynamic", async () => {
  const { useState } = await import("react");
  return {
    default: () => function Scanner({ onCancel, onSave }: { onCancel: () => void; onSave: (file: File) => Promise<boolean> }) {
      const [saved, setSaved] = useState(false);
      const [failed, setFailed] = useState(false);
      const [file] = useState(() => new File(["scan"], "Packing slip.pdf", { type: "application/pdf" }));
      return <section aria-label="Packing slip camera">
        {failed && <p role="alert">PDF was not saved. Tap Done to retry.</p>}
        {saved ? <><p>PDF saved</p><button onClick={onCancel}>Close scan</button></> : <>
          <button onClick={async () => { const ok = await onSave(file); setSaved(ok); setFailed(!ok); }}>Done</button>
          <button onClick={onCancel}>Cancel scan</button>
        </>}
      </section>;
    },
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("saves a scan with its order and returns to the slip list to watch it being read", async () => {
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
              currentVersionId: "version",
              packingSlip: {
                orderId: "order",
                materialListId: "list",
                orderNumber: "PO-123",
              },
              packingSlipAnalysis: {
                runId: "run",
                versionId: "version",
                status: "processing",
                startedAt: new Date().toISOString(),
                items: [],
                lines: [],
                warnings: [],
              },
            },
          ]
        : [],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByRole("region", { name: "Packing slip camera" });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await screen.findByText(/Reading packing slip and comparing it/);
  expect(screen.getByText("Reading…")).toBeInTheDocument();
  expect(screen.getByText(/It's being read now/)).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Packing slip camera" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
});
it("retains a failed scan for retry and offers read-only slips from a normal material list", async () => {
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
  await screen.findByRole("region", { name: "Packing slip camera" });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await screen.findByRole("alert");
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await screen.findByText(/It's being read now/);
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

it("opens the scanner directly for an order without requiring Take photo", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ canUpload: true, documents: [] })));
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByRole("region", { name: "Packing slip camera" });
  expect(screen.queryByRole("button", { name: "Take photo" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Scan packing slip" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel scan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Take photo" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByRole("region", { name: "Packing slip camera" });
});
it("does not open the camera before upload permission is confirmed", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ canUpload: false, documents: [] })));
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByText("No packing slips attached yet.");
  expect(screen.queryByRole("region", { name: "Packing slip camera" })).not.toBeInTheDocument();
});
it("shows the slip list with Upload instead of the scanner on a computer without a camera", async () => {
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: { enumerateDevices: async () => [{ kind: "audioinput" }] },
  });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ canUpload: true, documents: [] })));
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByRole("button", { name: "Upload photo or PDF" });
  expect(screen.queryByRole("region", { name: "Packing slip camera" })).not.toBeInTheDocument();
});
