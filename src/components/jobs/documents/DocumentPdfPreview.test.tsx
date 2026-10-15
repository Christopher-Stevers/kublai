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
type MockPage = {
  getViewport: (options: { scale: number }) => {
    width: number;
    height: number;
    convertToViewportPoint: (x: number, y: number) => number[];
  };
  render: typeof renderPage;
  getTextContent?: () => Promise<{
    items: Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
      hasEOL: boolean;
    }>;
  }>;
};
let getPage: ReturnType<typeof vi.fn<(page: number) => Promise<MockPage>>>;
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
      convertToViewportPoint: (x: number, y: number) => [
        x * scale,
        (800 - y) * scale,
      ],
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
  it("searches every page, highlights repeated matches and navigates across page boundaries", async () => {
    const pageValue = await getPage(1);
    getPage.mockImplementation(async (number: number) => ({
      ...pageValue,
      getTextContent: async () => ({
        items: (number === 1 ? ["Valve", "Schedule", "Valve"] : ["Valve"]).map(
          (str, index) => ({
            str,
            transform: [1, 0, 0, 1, 20 + index * 80, 700],
            width: 50,
            height: 12,
            hasEOL: false,
          }),
        ),
      }),
    }));
    const view = render(
      <DocumentPdfPreview
        url="/search.pdf"
        title="Searchable PDF"
        fillHeight
      />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search PDF text" }),
      { target: { value: "vAlVe" } },
    );
    await waitFor(() =>
      expect(screen.getByLabelText("PDF search results")).toHaveTextContent(
        "1 of 3",
      ),
    );
    await waitFor(() =>
      expect(
        view.container.querySelectorAll("[data-pdf-search-match]"),
      ).toHaveLength(2),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next search result" }));
    expect(screen.getByLabelText("PDF search results")).toHaveTextContent(
      "2 of 3",
    );
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    await waitFor(() =>
      expect(
        screen.getByLabelText("Searchable PDF, page 2"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("PDF search results")).toHaveTextContent(
      "3 of 3",
    );
    fireEvent.click(screen.getByRole("button", { name: "Next search result" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText("Searchable PDF, page 1"),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear PDF search" }));
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-pdf-search-match]"),
      ).toBeNull(),
    );
  });
  it("explains scanned PDFs instead of claiming a text search succeeded", async () => {
    const pageValue = await getPage(1);
    getPage.mockResolvedValue({
      ...pageValue,
      getTextContent: async () => ({ items: [] }),
    });
    render(<DocumentPdfPreview url="/scanned.pdf" title="Scanned PDF" />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "valve" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("PDF search results")).toHaveTextContent(
        "No searchable text",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Next search result" }),
    ).toBeDisabled();
  });
  it("returns to the captured PDF page, zoom and scroll without resetting later navigation", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
      1600,
    );
    const onReady = vi.fn();
    render(
      <DocumentPdfPreview
        url="/captured.pdf"
        title="Captured PDF"
        onReady={onReady}
        initialView={{ page: 2, zoom: 2, left: 0.25, top: 0.5 }}
      />,
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(getPage).toHaveBeenLastCalledWith(2);
    const canvas = screen.getByLabelText<HTMLCanvasElement>(
      "Captured PDF, page 2",
    );
    const frame = screen.getByTestId("pdf-scroll-area");
    expect(canvas.style.width).toBe("768px");
    expect(frame.scrollLeft).toBe(300);
    expect(frame.scrollTop).toBe(800);
    frame.scrollLeft = 50;
    fireEvent.click(screen.getByRole("button", { name: "Previous PDF page" }));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2));
    expect(getPage).toHaveBeenLastCalledWith(1);
    expect(frame.scrollLeft).toBe(50);
    expect(frame.scrollTop).toBe(0);
  });
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
