import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { DrawingWorkspace } from "../DrawingWorkspace";
const fixture = vi.hoisted(() => ({
  fullscreen: false,
  props: null as ComponentProps<typeof DrawingWorkspace> | null,
  mutate: vi.fn(),
  offline: false,
  saveSnapshot: vi.fn(async () => undefined),
  error: null as Error | null,
  snapshot: null as (() => unknown) | null,
  sheets: [1, 2].map((page) => ({
    id: `sheet-${page}`,
    name: `Page ${page}`,
    jobId: "job",
    setId: "set",
    imageUrl: `page-${page}`,
    width: 600,
    height: 800,
  })),
}));
vi.mock("../DrawingAccountProvider", () => {
  const account = { accountKey: "fixture:person", store: {
    readSnapshot: async () => fixture.offline ? fixture.sheets : null,
    saveSnapshot: fixture.saveSnapshot,
  } };
  return { useDrawingAccount: () => account };
});
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: {
      openDocument: {
        useMutation: () => ({
          mutate: fixture.mutate,
          data: fixture.error ? undefined : fixture.sheets,
          error: fixture.error,
          isPending: false,
        }),
      },
    },
  },
}));
vi.mock("~/components/chat/SnapshotSourceContext", () => ({
  useSnapshotSource: (_: string, read: () => unknown) => {
    fixture.snapshot = read;
  },
}));
vi.mock("../useDrawingFullscreen", () => ({
  useDrawingFullscreen: () => ({
    fullscreen: fixture.fullscreen,
    surface: null,
    enterButton: null,
    exitButton: null,
    enter: vi.fn(),
    exit: vi.fn(),
  }),
}));
vi.mock("../DrawingWorkspace", () => ({
  DrawingWorkspace: (props: ComponentProps<typeof DrawingWorkspace>) => {
    fixture.props = props;
    return (
      <div aria-label="Full drawing workspace">
        <button onClick={props.onReady}>Rendered</button>
        <button
          onClick={() =>
            props.onViewportChange?.({ center: { x: 0.6, y: 0.7 }, zoom: 10 })
          }
        >
          Zoom
        </button>
      </div>
    );
  },
}));
import { DocumentDrawingWorkspace } from "./DocumentDrawingWorkspace";
beforeEach(() => {
  const values=new Map<string,string>();
  vi.stubGlobal("localStorage", {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)});
  fixture.fullscreen = false;
  fixture.error = null;
  fixture.offline = false;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.clearAllMocks();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });
it("uses the full workspace with shared navigation and restores the PDF camera", () => {
  const onReady = vi.fn();
  render(
    <DocumentDrawingWorkspace
      jobId="job"
      versionId="version"
      onReady={onReady}
      initialView={{
        page: 2,
        zoom: 3,
        left: 0,
        top: 0,
        viewport: { center: { x: 0.4, y: 0.5 }, zoom: 3 },
      }}
    />,
  );
  expect(fixture.mutate).toHaveBeenCalledWith({
    jobId: "job",
    versionId: "version",
  });
  expect(fixture.props?.sheet.id).toBe("sheet-2");
  expect(fixture.props?.initialViewport?.zoom).toBe(3);
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(onReady).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Rendered"));
  expect(onReady).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Zoom"));
  expect(screen.getByLabelText("Drawing zoom")).toHaveTextContent("1000%");
  expect(fixture.snapshot?.()).toMatchObject({ page: 2, zoom: 10 });
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(fixture.props?.sheet.id).toBe("sheet-1");
  expect(fixture.props?.initialViewport?.zoom).toBe(1);
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  expect(screen.getByText("1 of 2")).toBeInTheDocument();
});
it("keeps unavailable or unauthorized documents out of the workspace and offers retry", () => {
  fixture.error = new Error("Document not found.");
  render(<DocumentDrawingWorkspace jobId="job" versionId="private" />);
  expect(screen.getByRole("alert")).toHaveTextContent("Document not found");
  expect(
    screen.queryByLabelText("Full drawing workspace"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(fixture.mutate).toHaveBeenLastCalledWith({
    jobId: "job",
    versionId: "private",
  });
});

it("reopens downloaded document sheets offline without calling the server", async () => {
  fixture.offline = true;
  fixture.error = new Error("No network");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  render(<DocumentDrawingWorkspace jobId="job" versionId="version" />);
  await screen.findByLabelText("Full drawing workspace");
  expect(fixture.mutate).not.toHaveBeenCalled();
  await fixture.props?.onPrepareOffline?.();
  await waitFor(() => expect(fixture.saveSnapshot).toHaveBeenCalledWith("document-sheets:version", fixture.sheets));
});

it("ties document quick wheel to fullscreen and restores navigation and zoom on exit", () => {
  const view = render(<DocumentDrawingWorkspace jobId="job" versionId="version" />);
  expect(fixture.props?.fullscreen).toBe(false);
  fireEvent.click(screen.getByText("Zoom"));
  fixture.fullscreen = true;
  view.rerender(<DocumentDrawingWorkspace jobId="job" versionId="version" />);
  expect(fixture.props?.fullscreen).toBe(true);
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  expect(document.documentElement).toHaveAttribute("data-drawing-quick-wheel-page");
  fixture.fullscreen = false;
  view.rerender(<DocumentDrawingWorkspace jobId="job" versionId="version" />);
  expect(fixture.props?.fullscreen).toBe(false);
  expect(screen.getByRole("button", { name: "Next" })).toBeVisible();
  expect(screen.getByLabelText("Drawing zoom")).toHaveTextContent("1000%");
  expect(document.documentElement).not.toHaveAttribute("data-drawing-quick-wheel-page");
});

it("shares the folder preference across documents and keeps the root separate", () => {
  const key=`foremanhq:page-mode:v3:${JSON.stringify(["fixture:person","document-folder:job:folder-a"])}`;
  localStorage.setItem(key,"scroll");
  const view=render(<DocumentDrawingWorkspace jobId="job" versionId="first" folderId="folder-a" />);
  expect(fixture.props?.scrollPages).toBe(true);
  expect(fixture.props?.pageModeScope).toBe("document-folder:job:folder-a");
  view.rerender(<DocumentDrawingWorkspace jobId="job" versionId="second" folderId="folder-a" />);
  expect(fixture.props?.scrollPages).toBe(true);
  view.rerender(<DocumentDrawingWorkspace jobId="job" versionId="third" folderId="folder-b" />);
  expect(fixture.props?.scrollPages).toBe(false);
  view.rerender(<DocumentDrawingWorkspace jobId="job" versionId="root" folderId={null} />);
  expect(fixture.props?.pageModeScope).toBe("document-folder:job:root");
  expect(fixture.props?.scrollPages).toBe(false);
  localStorage.removeItem(key);
});

it.each(["buttons", "scroll"])("replaces the previous viewer during repeated %s page changes", (mode) => {
  localStorage.setItem(`foremanhq:page-mode:v3:${JSON.stringify(["fixture:person","document-folder:job:root"])}`, mode);
  render(<DocumentDrawingWorkspace jobId="job" versionId="version" />);
  for (const offset of [1, -1, 1, -1, 1]) {
    const previous = screen.getByLabelText("Full drawing workspace");
    if (mode === "buttons") {
      fireEvent.click(screen.getByRole("button", { name: offset > 0 ? "Next" : "Previous" }));
    } else {
      act(() => fixture.props?.scrollStack?.onPage(offset, { center: { x: 0.5, y: 0.5 }, zoom: 1 }));
    }
    expect(screen.getAllByLabelText("Full drawing workspace")).toHaveLength(1);
    expect(previous).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Drawing zoom")).toHaveLength(1);
  }
});
