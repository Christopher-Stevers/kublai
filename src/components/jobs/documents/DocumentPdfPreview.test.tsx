import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { snapshotStateSchema } from "~/lib/snapshot-source";
import { loadPdfDocument } from "~/lib/pdf-client";
import type { ComponentProps } from "react";
import type { DrawingSheetViewer } from "../DrawingSheetViewer";
const state = vi.hoisted(() => ({
  props: null as ComponentProps<typeof DrawingSheetViewer> | null,
  snapshot: null as (() => unknown) | null,
}));
vi.mock("~/lib/pdf-client", () => ({ loadPdfDocument: vi.fn() }));
vi.mock("~/components/chat/SnapshotSourceContext", () => ({
  useSnapshotSource: (_: string, read: () => unknown) => {
    state.snapshot = read;
  },
}));
vi.mock("../DrawingSheetViewer", () => ({
  DrawingSheetViewer: (props: ComponentProps<typeof DrawingSheetViewer>) => {
    state.props = props;
    return (
      <div aria-label={props.alt}>
        <button onClick={props.onPdfReady}>Render shared drawing</button>
        <button
          onClick={() =>
            props.onViewportChange?.({ center: { x: 0.7, y: 0.6 }, zoom: 50 })
          }
        >
          Pan drawing
        </button>
      </div>
    );
  },
}));
import { DocumentPdfPreview as DocumentDrawingViewer } from "./DocumentPdfPreview";
beforeEach(() => {
  vi.clearAllMocks();
  state.props = null;
  vi.mocked(loadPdfDocument).mockResolvedValue({
    numPages: 2,
    getPage: async (page: number) => ({
      getViewport: () => ({
        width: 600,
        height: 800,
        convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
      }),
      getTextContent: async () => ({
        items: Array.from({ length: page === 1 ? 2 : 1 }, (_, index) => ({
          str: "Valve",
          transform: [1, 0, 0, 1, 20 + index * 80, 700],
          width: 50,
          height: 12,
          hasEOL: false,
        })),
      }),
    }),
  } as unknown as Awaited<ReturnType<typeof loadPdfDocument>>);
});
afterEach(cleanup);
it("uses the shared drawing renderer with the authenticated source and only declares readiness after ink is painted", async () => {
  const ready = vi.fn();
  render(
    <DocumentDrawingViewer
      url="/api/job-documents/files/private?jobId=job"
      title="Product PDF"
      onReady={ready}
      fillHeight
    />,
  );
  await screen.findByLabelText("Product PDF, page 1");
  expect(state.props?.pdf).toEqual({
    url: "/api/job-documents/files/private?jobId=job",
    page: 1,
  });
  expect(ready).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Render shared drawing"));
  expect(ready).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Next PDF page" }));
  await screen.findByLabelText("Product PDF, page 2");
  expect(state.props?.pdf?.page).toBe(2);
  expect(ready).toHaveBeenCalledOnce();
});
it("searches across pages and navigates/highlights results inside the drawing viewer", async () => {
  render(
    <DocumentDrawingViewer
      url="/search.pdf"
      title="Searchable PDF"
      fillHeight
    />,
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "vAlVe" },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("PDF search results")).toHaveTextContent(
      "1 of 3",
    ),
  );
  expect(state.props?.annotations).toHaveLength(2);
  expect(state.props?.navigateTo?.center.x).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Next search result" }));
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
  await screen.findByLabelText("Searchable PDF, page 2");
  expect(state.props?.annotations).toHaveLength(1);
  expect(screen.getByLabelText("PDF search results")).toHaveTextContent(
    "3 of 3",
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear PDF search" }));
  await waitFor(() => expect(state.props?.annotations).toHaveLength(0));
  fireEvent.keyDown(window, { key: "f", ctrlKey: true });
  expect(screen.getByRole("searchbox")).toHaveFocus();
});
it("captures and restores drawing camera positions including 5000 percent zoom", async () => {
  const viewport = { center: { x: 0.6, y: 0.7 }, zoom: 30 };
  render(
    <DocumentDrawingViewer
      url="/capture.pdf"
      title="Capture"
      initialView={{ page: 2, zoom: 30, left: 0, top: 0, viewport }}
    />,
  );
  await screen.findByLabelText("Capture, page 2");
  expect(state.props?.initialViewport).toEqual(viewport);
  fireEvent.click(screen.getByText("Pan drawing"));
  expect(state.snapshot?.()).toMatchObject({
    page: 2,
    zoom: 50,
    viewport: { center: { x: 0.7, y: 0.6 }, zoom: 50 },
  });
  expect(
    snapshotStateSchema.safeParse({ version: 1, pdf: state.snapshot?.() })
      .success,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  expect(state.props?.navigateTo).toMatchObject({
    center: { x: 0.5, y: 0.5 },
    zoom: 1,
  });
});
it("does not send inaccessible document versions to the drawing renderer", async () => {
  vi.mocked(loadPdfDocument).mockRejectedValue(
    new Error("You no longer have access"),
  );
  const ready = vi.fn();
  render(
    <DocumentDrawingViewer
      url="/private.pdf"
      title="Private"
      onReady={ready}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "no longer have access",
  );
  expect(state.props).toBeNull();
  expect(ready).not.toHaveBeenCalled();
});
