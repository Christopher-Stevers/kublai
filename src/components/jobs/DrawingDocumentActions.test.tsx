import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadDrawingPackage,
  downloadDrawingPdf,
  downloadOriginalDrawing,
  printDrawingPackage,
  printDrawingPdf,
} from "~/lib/drawing-pdf-export";
import {
  collectDrawingOfflineUrls,
  type DrawingOfflineStore,
} from "~/lib/drawing-offline";
import type { DrawingEntity } from "~/lib/drawing-workspace";
import { warmDrawingPdfRuntime } from "~/lib/drawing-pdf-offline-runtime";
import { DrawingDocumentActions } from "./DrawingDocumentActions";

vi.mock("~/lib/drawing-pdf-export", () => ({
  downloadDrawingPdf: vi.fn(),
  downloadDrawingPackage: vi.fn(),
  downloadOriginalDrawing: vi.fn(),
  printDrawingPdf: vi.fn(),
  printDrawingPackage: vi.fn(),
}));
vi.mock("~/lib/drawing-offline", () => ({
  collectDrawingOfflineUrls: vi.fn(),
  DRAWING_OFFLINE_BUDGET: 128 * 1024 * 1024,
}));
vi.mock("~/lib/drawing-pdf-offline-runtime", () => ({
  warmDrawingPdfRuntime: vi.fn(),
}));
const sheet = {
  id: "0391aed4-7773-47ec-9141-09df373ec008",
  name: "A101",
  imageUrl:
    "/api/job-rooms/files/0391aed4-7773-47ec-9141-09df373ec008/d814fc88-da7c-4df5-aa89-fe3c1fde0462/floor-14.webp",
};
const entity = {
  kind: "markup",
  visibility: "published",
  data: {
    sourceSheetId: sheet.id,
    type: "text",
    points: [{ x: 0.1, y: 0.2 }],
    text: "A note",
    stroke: "#ff0000",
    width: 2,
  },
} as DrawingEntity;
const printWindow = { close: vi.fn(), opener: null } as unknown as Window;
beforeEach(() => {
  vi.spyOn(window, "open").mockReturnValue(printWindow);
  vi.mocked(downloadDrawingPdf).mockResolvedValue(undefined);
  vi.mocked(downloadOriginalDrawing).mockResolvedValue(undefined);
  vi.mocked(printDrawingPdf).mockResolvedValue(undefined);
  vi.mocked(downloadDrawingPackage).mockResolvedValue(undefined);
  vi.mocked(printDrawingPackage).mockResolvedValue(undefined);
  vi.mocked(collectDrawingOfflineUrls).mockResolvedValue([sheet.imageUrl]);
  vi.mocked(warmDrawingPdfRuntime).mockResolvedValue({ files: 22, bytes: 10 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("drawing document actions", () => {
  it("resolves a multiple-destination PDF annotation to its saved ForemanHQ chooser", async () => {
    const linked: DrawingEntity = {
      ...entity,
      id: "hyperlink",
      sheetId: sheet.id,
      kind: "markup",
      data: {
        ...entity.data,
        type: "link",
        links: [
          { label: "Manual", url: "https://example.com/manual" },
          { label: "Sheet", targetSheetId: sheet.id },
        ],
      },
    } as DrawingEntity;
    render(
      <DrawingDocumentActions
        sheet={sheet}
        jobId="job"
        sheets={[{ ...sheet, setId: "folder" }]}
        entities={[linked]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Download this sheet" }),
    );
    await waitFor(() => expect(downloadDrawingPdf).toHaveBeenCalled());
    const options = vi.mocked(downloadDrawingPdf).mock.calls[0]![0];
    if (linked.kind !== "markup") throw Error("fixture");
    expect(options.markupLinkUrl?.(linked.data)).toBe(
      `${location.origin}/dashboard/jobs/job/drawings?drawingSet=folder&drawingSheet=${sheet.id}&drawingLink=hyperlink`,
    );
  });
  it("exports the original page index and only includes visible annotations when selected", async () => {
    render(
      <DrawingDocumentActions
        sheet={sheet}
        entities={[entity, { ...entity, visibility: "archived" }]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Download this sheet" }),
    );
    await waitFor(() =>
      expect(downloadDrawingPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          pageNumber: 14,
          sourceSheetId: sheet.id,
          markups: [entity.data],
        }),
        "A101.pdf",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Print" })).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Include visible markups/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(window.open).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(printDrawingPdf).toHaveBeenCalledWith(
        expect.objectContaining({ markups: [], pageNumber: 14 }),
        printWindow,
      ),
    );
  });

  it("downloads and prints every package snapshot in the selected order", async () => {
    const next = {
      ...sheet,
      id: "d814fc88-da7c-4df5-aa89-fe3c1fde0462",
      name: "A102",
      imageUrl: sheet.imageUrl.replace("floor-14", "floor-3"),
    };
    render(
      <DrawingDocumentActions
        sheet={sheet}
        sheets={[next, sheet]}
        entities={[entity]}
        packageMode
        title="Issued package"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Save offline" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download package" }));
    await waitFor(() =>
      expect(downloadDrawingPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Issued package",
          sheets: [
            expect.objectContaining({ pageNumber: 3, sourceSheetId: next.id }),
            expect.objectContaining({
              pageNumber: 14,
              sourceSheetId: sheet.id,
            }),
          ],
        }),
        "Issued package.pdf",
      ),
    );
    expect(downloadDrawingPdf).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Print package" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Print package" }));
    await waitFor(() => expect(printDrawingPackage).toHaveBeenCalledOnce());
    const [printed, target] = vi.mocked(printDrawingPackage).mock.calls[0]!;
    expect(printed.sheets.map((item) => item.pageNumber)).toEqual([3, 14]);
    expect(target).toBe(printWindow);
  });

  it("downloads nothing automatically and makes sharp-tile downloading an explicit choice", async () => {
    const saveAssets = vi.fn(async () => ({ files: 1, bytes: 4 }));
    const store = {
      summary: async () => ({ files: 0, bytes: 0 }),
      saveAssets,
    } as unknown as DrawingOfflineStore;
    const snapshots = vi.fn(async () => undefined);
    render(
      <DrawingDocumentActions
        sheet={sheet}
        store={store}
        onOfflineSaved={snapshots}
      />,
    );
    expect(saveAssets).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("Offline download selection"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Include sharp tiles/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save offline" }));
    await waitFor(() =>
      expect(collectDrawingOfflineUrls).toHaveBeenCalledWith(
        [sheet.imageUrl],
        expect.objectContaining({ includeTiles: true }),
      ),
    );
    await waitFor(() => expect(snapshots).toHaveBeenCalledOnce());
    expect(
      await screen.findByText("Drawings saved for offline viewing."),
    ).toBeVisible();
  });

  it("cancels a pending offline download on unmount", async () => {
    let signal: AbortSignal | undefined;
    const saveAssets = vi.fn(
      (_urls: string[], options: { signal: AbortSignal }) => {
        signal = options.signal;
        return new Promise<never>((_resolve, reject) =>
          signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          ),
        );
      },
    );
    const store = {
      summary: async () => ({ files: 0, bytes: 0 }),
      saveAssets,
    } as unknown as DrawingOfflineStore;
    const view = render(<DrawingDocumentActions sheet={sheet} store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Save offline" }));
    await waitFor(() => expect(saveAssets).toHaveBeenCalledOnce());
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("does not claim offline readiness or save private assets when the PDF runtime cannot be retained", async () => {
    vi.mocked(warmDrawingPdfRuntime).mockRejectedValueOnce(
      new Error("Reload to finish updating offline drawing support."),
    );
    const saveAssets = vi.fn();
    const store = {
      summary: async () => ({ files: 0, bytes: 0 }),
      saveAssets,
    } as unknown as DrawingOfflineStore;
    render(<DrawingDocumentActions sheet={sheet} store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Save offline" }));
    expect(
      await screen.findByText(
        "Reload to finish updating offline drawing support.",
      ),
    ).toBeVisible();
    expect(saveAssets).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Drawings saved for offline viewing."),
    ).not.toBeInTheDocument();
  });
});
