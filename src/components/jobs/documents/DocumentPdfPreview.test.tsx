import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPdfDocument } from "~/lib/pdf-client";
import { DocumentPdfPreview } from "./DocumentPdfPreview";
vi.mock("~/lib/pdf-client", () => ({ loadPdfDocument: vi.fn() }));
let renderPage: ReturnType<typeof vi.fn>;
let getPage: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  cancel = vi.fn();
  renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel }));
  getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
    }),
    render: renderPage,
  }));
  vi.mocked(loadPdfDocument).mockResolvedValue({
    numPages: 2,
    getPage,
  } as unknown as Awaited<ReturnType<typeof loadPdfDocument>>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Private PDF preview without browser plugins", () => {
  it("renders an authenticated URL, reports readiness, pages through a document, and zooms without a plugin", async () => {
    const onReady = vi.fn();
    render(
      <DocumentPdfPreview
        url="/api/job-documents/files/version?jobId=job"
        title="Product PDF"
        onReady={onReady}
      />,
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(loadPdfDocument).toHaveBeenCalledWith(
      "/api/job-documents/files/version?jobId=job",
    );
    expect(screen.queryByTitle("Product PDF")).not.toBeInTheDocument(); // no embedded plugin
    expect(
      screen.getByRole("button", { name: "Previous PDF page" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next PDF page" }));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2));
    expect(getPage).toHaveBeenLastCalledWith(2);
    expect(
      screen.getByRole("button", { name: "Next PDF page" }),
    ).toBeDisabled();
    const canvas = screen.getByLabelText<HTMLCanvasElement>(
      "Product PDF, page 2",
    );
    const width = canvas.width;
    fireEvent.click(screen.getByRole("button", { name: "Zoom PDF in" }));
    await waitFor(() => expect(canvas.width).toBeGreaterThan(width));
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    await waitFor(() => expect(canvas.width).toBe(width));
  });
  it("bounds raster memory for oversized sheets", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
      10000,
    );
    render(<DocumentPdfPreview url="/large.pdf" title="Large PDF" />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    const canvas =
      screen.getByLabelText<HTMLCanvasElement>("Large PDF, page 1");
    expect(canvas.width * canvas.height).toBeLessThan(8_020_000);
  });
  it("shows failed private-file access without claiming the revision is ready", async () => {
    vi.mocked(loadPdfDocument).mockRejectedValue(
      new Error("You no longer have access"),
    );
    const onReady = vi.fn();
    render(
      <DocumentPdfPreview
        url="/private.pdf"
        title="Private PDF"
        onReady={onReady}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no longer have access",
    );
    expect(onReady).not.toHaveBeenCalled();
  });
  it("cancels unfinished renders when a revision is closed", async () => {
    renderPage.mockReturnValue({
      promise: new Promise<void>(() => undefined),
      cancel,
    });
    const onReady = vi.fn();
    const view = render(
      <DocumentPdfPreview
        url="/private.pdf"
        title="Private PDF"
        onReady={onReady}
      />,
    );
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });
});
