import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { DrawingWorkspace } from "../DrawingWorkspace";
const fixture = vi.hoisted(() => ({
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
    fullscreen: false,
    surface: null,
    enterButton: null,
    exitButton: null,
    enter: vi.fn(),
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
  fixture.error = null;
  fixture.offline = false;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.clearAllMocks();
});
afterEach(() => { cleanup(); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });
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
