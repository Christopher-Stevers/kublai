import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import { HYPERLINK_VISIT_EVENT } from "~/hooks/use-hyperlink-back";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DrawingEntity,
  DrawingSave,
  DrawingWorkspace as Workspace,
} from "~/lib/drawing-workspace";
import { useEffect, type ComponentProps } from "react";
import type { DrawingSheetViewer } from "./DrawingSheetViewer";
import { DrawingWorkspace, panels, tools } from "./DrawingWorkspace";
import type { DrawingCompare } from "./DrawingCompare";
import { DRAWING_DESTINATION_EVENT, makeSnapshotSource } from "~/lib/snapshot-source";

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  push: vi.fn(),
  account: null as { userId: string; accountKey: string; store: null } | null,
  data: null as Workspace | null,
  save: vi.fn<(value: DrawingSave) => Promise<DrawingEntity>>(),
  metadata: vi.fn(),
  setScale: vi.fn(),
  archive: vi.fn(),
  comment: vi.fn(),
  version: vi.fn(),
  favorite: vi.fn(),
  watch: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(async () => undefined),
  scaleResult: vi.fn(),
  invalidate: vi.fn(async () => undefined),
}));
vi.mock("next/navigation", () => {
  const router = { push: mocks.push };
  return { useRouter: () => router };
});
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      drawingsWorkspace: {
        get: {
          invalidate: mocks.invalidate,
          cancel: mocks.cancel,
          setData: (
            _: unknown,
            update: (data: Workspace | null) => Workspace | null,
          ) => {
            mocks.data = update(mocks.data);
          },
        },
        list: { invalidate: mocks.invalidate },
        notifications: { invalidate: mocks.invalidate },
      },
    }),
    drawingsWorkspace: {
      addMeasurementLayer: { useMutation: () => ({ mutateAsync: vi.fn(async () => undefined) }) },
      setScale: { useMutation: () => ({ mutateAsync: mocks.setScale }) },
      linkTargets: {
        useQuery: () => ({
          data: { jobs: [], targets: [] },
          isFetching: false,
          error: null,
        }),
      },
      get: {
        useQuery: () => ({
          data: mocks.data,
          error: null,
          refetch: mocks.invalidate,
        }),
      },
      notifications: {
        useQuery: () => ({ data: [], error: null, isLoading: false }),
      },
      save: { useMutation: () => ({ mutateAsync: mocks.save }) },
      metadata: { useMutation: () => ({ mutateAsync: mocks.metadata }) },
      archive: { useMutation: () => ({ mutateAsync: mocks.archive }) },
      comment: { useMutation: () => ({ mutateAsync: mocks.comment }) },
      setCurrentVersion: {
        useMutation: () => ({ mutateAsync: mocks.version }),
      },
      favorite: { useMutation: () => ({ mutateAsync: mocks.favorite }) },
      watch: { useMutation: () => ({ mutateAsync: mocks.watch }) },
      readNotification: { useMutation: () => ({ mutateAsync: mocks.read }) },
    },
  },
}));
vi.mock("~/hooks/use-drawing-workspace-query", () => ({
  useDrawingWorkspaceQuery: () => ({ data: mocks.data, error: null, refetch: mocks.invalidate }),
}));

vi.mock("./DrawingAccountProvider", () => ({
  useDrawingAccount: () => mocks.account,
}));
vi.mock("./DrawingDocumentActions", () => ({
  DrawingDocumentActions: () => <div>Document actions</div>,
}));
vi.mock("./DrawingReferenceLinks", () => ({
  DrawingReferenceLinks: ({ words }: { words: Array<{ text: string }> }) => (
    <div data-testid="reference-words">
      {words.map((word) => word.text).join(" ")}
    </div>
  ),
}));
vi.mock("./DrawingCompare", () => ({
  DrawingCompare: (props: ComponentProps<typeof DrawingCompare>) => (
    <div
      data-testid="comparison"
      data-focus={JSON.stringify(props.initialViewport)}
      data-first={props.first.id}
      data-second={props.second.id}
      data-additional={JSON.stringify(
        props.additional?.map((sheet) => sheet.id) ?? [],
      )}
    >
      <button
        onClick={() =>
          props.onViewportChange?.({ center: { x: 0.8, y: 0.6 }, zoom: 4 })
        }
      >
        Pan overlay
      </button>
      <button onClick={props.onClose}>Close comparison</button>
      <button onClick={props.onEditDrawings}>Choose Drawings</button>
    </div>
  ),
}));
vi.mock("./SuperScaleDialog", () => ({ SuperScaleDialog: ({onCalibrate}: {onCalibrate?:()=>void}) => <div>Super scale grid matching<button onClick={onCalibrate}>Start new Super scale</button></div> }));
vi.mock("./DrawingSheetViewer", () => ({
  DrawingSheetViewer: (props: ComponentProps<typeof DrawingSheetViewer>) => {
    mocks.viewer(props);
    const request = props.toolControls?.modeRequest;
    const onMode = props.toolControls?.onMode;
    useEffect(() => {
      onMode?.({
        measuring: request?.mode === "measure",
        pipe: request?.mode === "pipe",
      });
    }, [request, onMode]);
    return (
      <div
        data-testid="markup-editor"
        data-tool={props.tool}
        data-selection-mode={props.selectionMode}
      >
        <button
          onClick={() =>
            props.onPdfLink?.({
              left: 0.1,
              top: 0.1,
              right: 0.2,
              bottom: 0.2,
              page: 2,
            })
          }
        >
          Follow original page link
        </button>
        <button
          onClick={() =>
            props.onPdfLink?.({
              left: 0.1,
              top: 0.1,
              right: 0.2,
              bottom: 0.2,
              url: "http://example.com/drawing",
            })
          }
        >
          Follow original web link
        </button>
        <div data-testid="viewer-source">
          {props.sourceSheetId ?? props.sheetKey}
        </div>
        {props.textEditing && (
          <div>
            <textarea
              aria-label="Text"
              value={props.textEditing.data.text ?? ""}
              onChange={(event) =>
                props.textEditing!.onChange({
                  ...props.textEditing!.data,
                  text: event.target.value,
                })
              }
            />
            <button onClick={props.textEditing.onDone}>
              Done editing text
            </button>
          </div>
        )}
        <div data-testid="inherited-viewport">
          {JSON.stringify(props.initialViewport)}
        </div>
        <button
          onClick={() =>
            props.onViewportChange?.({ center: { x: 0.2, y: 1.1 }, zoom: 2 })
          }
        >
          Pan beyond sheet
        </button>
        <button
          disabled={!props.onScaleChange}
          onClick={() => {
            void Promise.resolve()
              .then(() =>
                props.onScaleChange?.({ unit: "m", unitsPerSheetWidth: 120 }),
              )
              .then(mocks.scaleResult)
              .catch((error: unknown) => {
                mocks.scaleResult(
                  error instanceof Error ? error.message : "Save failed",
                );
              });
          }}
        >
          Calibrate sample
        </button>
        <div data-testid="shared-scale">
          {props.sharedScale?.unitsPerSheetWidth ?? "unset"}
        </div>
        <button
          onClick={() =>
            props.onCreate?.({
              sourceSheetId: props.sourceSheetId!,
              type:
                props.tool === "text"
                  ? "text"
                  : props.tool === "link"
                    ? "link"
                    : "rect",
              points:
                props.tool === "text"
                  ? [{ x: 0.2, y: 0.2 }]
                  : [
                      { x: 0.2, y: 0.2 },
                      { x: 0.4, y: 0.4 },
                    ],
              stroke: "#ef4444",
              width: 2,
            })
          }
        >
          Draw sample
        </button>
        <button
          onClick={() => props.onSelect?.(props.annotations?.[0]?.id ?? null)}
        >
          Select first annotation
        </button>
        <button
          onClick={() => {
            const first = props.annotations?.[0];
            if (first?.kind === "markup") props.onActivate?.(first.data);
          }}
        >
          Tap hyperlink
        </button>
        <button
          onClick={() => {
            const entity = props.annotations?.[0];
            if (
              entity?.kind === "markup" &&
              props.canEditAnnotation?.(entity.id)
            )
              props.onUpdate?.(entity.id, {
                ...entity.data,
                points: [
                  { x: 0.3, y: 0.3 },
                  { x: 0.6, y: 0.6 },
                ],
              });
          }}
        >
          Move selected annotation
        </button>
      </div>
    );
  },
}));

const sheetId = "5d9a7cbd-7c52-48ed-b7ca-d14f423b3e19";
const revisionId = "c714b807-1f81-4e94-bb39-d251849313df";
const entityId = "448ec95c-3c84-4d20-81f4-0bb9ff0c3b45";
const jobId = "65eef309-0b45-4aa1-bc39-8dfe5a3297ab";
const sheet = {
  id: sheetId,
  name: "A101",
  imageUrl: "/drawing.webp",
  width: 1000,
  height: 500,
};
function fixture(): Workspace {
  return {
    sheetId,
    jobId,
    canManage: true,
    actor: { id: "tim", name: "Tim" },
    members: [
      { id: "tim", name: "Tim" },
      { id: "chris", name: "Chris" },
    ],
    jobSheets: [
      sheet,
      { ...sheet, id: revisionId, name: "A101 revision 2" },
    ].map((item) => ({
      ...item,
      sheetId: item.id,
      setId: jobId,
      sourceFilename: "plan.pdf",
    })),
    entities: [],
    metadata: {
      revision: 7,
      currentSourceSheetId: sheetId,
      number: "A101",
      title: "Original title",
      discipline: "Architectural",
      tags: [],
      status: "draft",
      scale: null,
    },
    favorite: false,
    watching: false,
    activity: [],
  };
}
function existingMarkup(
  visibility: "private" | "published" = "private",
): DrawingEntity {
  return {
    id: entityId,
    sheetId,
    kind: "markup",
    visibility,
    revision: 4,
    authorId: "tim",
    authorName: "Tim",
    comments: [],
    createdAt: "",
    updatedAt: "",
    data: {
      sourceSheetId: sheetId,
      type: "rect",
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.4 },
      ],
      stroke: "#ef4444",
      width: 2,
    },
  };
}
const open = () =>
  render(
    <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
  );
// The bottom bar: panels are in More, markup types in Markup, others in Tools.
const openMenu = (name: string) =>
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
const panel = (name: string) => {
  openMenu("More");
  fireEvent.click(
    screen.getByRole("menuitem", {
      name: panels.find(([id]) => id === name)![1],
    }),
  );
};
const chooseTool = (id: string) => {
  const label = tools.find(([tool]) => tool === id)![1];
  const active = within(screen.getByRole("toolbar", {name:"Drawing tools"})).queryAllByRole("button", {pressed:true});
  for (const button of active) fireEvent.click(button);
  if (["pan", "select", "link", "issue", "rfi"].includes(id)) {
    openMenu("Tools");
    fireEvent.click(screen.getByRole("menuitemradio", { name: label }));
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Markup" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
  }
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.setScale.mockImplementation(async ({scale}: {scale: Workspace["metadata"]["scale"]}) => ({
    ...mocks.data!.metadata, scale, revision: mocks.data!.metadata.revision + 1,
  }));
  mocks.account = null;
  mocks.data = fixture();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mocks.save.mockImplementation(
    async (value) =>
      ({
        id: value.id,
        sheetId,
        kind: value.kind,
        data: value.data,
        visibility: value.visibility,
        revision: value.expectedRevision + 1,
        authorId: "tim",
        authorName: "Tim",
        createdAt: "2026-10-07",
        updatedAt: "2026-10-07",
        comments: [],
      }) as DrawingEntity,
  );
  mocks.metadata.mockImplementation(
    async (input: { data: Workspace["metadata"] }) => ({
      ...input.data,
      revision: 8,
      currentSourceSheetId: sheetId,
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("drawing workspace workflows", () => {
  it("switches from measuring to Viewing through Tools and returns to normal interaction", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    openMenu("Tools");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Viewing" }));
    expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool", "viewing");
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(props.toolControls?.modeRequest?.mode).toBe("idle");
    expect(props.selectedId).toBeNull();
    expect(screen.getByRole("button", { name: "Measure" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Viewing" }));
    expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool", "pan");
  });
  it("offers Viewing in the quick wheel and clears the selected markup", () => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "foremanhq:drawing-quick-wheel:guest" ? "on" : null });
    mocks.data!.entities = [existingMarkup()];
    open();
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    act(() => props.onSelect?.(entityId));
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "Drawing tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Viewing" }));
    const next = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(next.tool).toBe("viewing");
    expect(next.selectedId).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("makes Viewing available to users who cannot annotate", () => {
    mocks.data!.canAnnotate = false;
    open(); openMenu("Tools");
    const viewing = screen.getByRole("menuitemradio", { name: "Viewing" });
    expect(viewing).not.toHaveAttribute("data-disabled");
    fireEvent.click(viewing);
    expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool", "viewing");
  });
  it("finishes a text note when entering Viewing without reselecting the saved note", async () => {
    open(); chooseTool("text");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Keep this note" } });
    openMenu("Tools");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Viewing" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({ data: { type: "text", text: "Keep this note" } });
    expect(screen.queryByLabelText("Text")).toBeNull();
    const next = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(next.tool).toBe("viewing");
    expect(next.selectedId).toBeNull();
  });
  it("retains wheel navigation and an exit when offline annotation data is unavailable", () => {
    const stored = new Map([["foremanhq:drawing-quick-wheel:guest", "on"]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mocks.data = null;
    const next = vi.fn();
    render(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} pageNavigation={{ index: 0, count: 2, onPrevious: vi.fn(), onNext: next }} />);
    fireEvent.keyDown(screen.getByTestId("markup-editor"), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "Next" })); expect(next).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByTestId("markup-editor"), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Quickwheel mode off" }));
    expect(stored.get("foremanhq:drawing-quick-wheel:guest")).toBe("off");
  });

  it("lets More opt into Quickwheel mode, uses the same measurement command, and restores the bars from the wheel", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    open(); openMenu("More");
    const toggle = screen.getByRole("switch", { name: "Quickwheel mode" });
    expect(toggle).not.toBeChecked(); fireEvent.click(toggle);
    expect(screen.queryByRole("toolbar", { name: "Drawing tools" })).toBeNull();
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "F10", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(mocks.viewer.mock.lastCall?.[0].toolControls.modeRequest.mode).toBe("measure");
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "F10", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Quickwheel mode off" }));
    expect(screen.getByRole("toolbar", { name: "Drawing tools" })).toBeInTheDocument();
    expect(mocks.viewer.mock.lastCall?.[0].toolControls.modeRequest.mode).toBe("measure");
  });

  it("exposes page navigation and selected markup actions through the wheel", async () => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "foremanhq:drawing-quick-wheel:guest" ? "on" : null });
    mocks.data!.entities = [existingMarkup()];
    const onNext = vi.fn();
    render(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()}
      pageNavigation={{ index: 0, count: 2, onPrevious: vi.fn(), onNext }} />);
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "Page" }));
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" })); expect(onNext).toHaveBeenCalledOnce();
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    act(() => props.onSelect?.(entityId));
    expect(screen.queryByRole("toolbar", { name: "Selected markup actions" })).toBeNull();
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "ContextMenu" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Resize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("prompts to calibrate before Super scale, then continues only after a saved calibration", () => {
    open();
    const start = () => {
      openMenu("More");
      fireEvent.click(screen.getByRole("menuitem", { name: "Super scale" }));
      fireEvent.click(screen.getByRole("button", { name: "Start new Super scale" }));
      expect(screen.getByRole("heading", { name: "Super scale — set scale first" })).toBeInTheDocument();
      expect(screen.queryByText("Super scale grid matching")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Set scale" }));
      const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
      expect(props.toolControls?.modeRequest?.mode).toBe("calibrate");
      return props;
    };
    const canceled = start();
    act(() => canceled.toolControls?.onCalibrationEnd?.(false));
    expect(screen.queryByText("Super scale grid matching")).toBeNull();
    const saved = start();
    act(() => saved.toolControls?.onCalibrationEnd?.(true));
    expect(screen.getByText("Super scale grid matching")).toBeInTheDocument();
  });

  it("offers Super scale under More", () => {
    open();
    openMenu("More");
    expect(screen.getByRole("menuitem", { name: "Super scale" })).toBeInTheDocument();
    for (const name of ["Super scale results", "Snapshot", "Download / offline", "Available offline"]) {
      expect(screen.queryByRole("menuitem", {name})).toBeNull();
      expect(screen.queryByRole("button", {name})).toBeNull();
    }
    fireEvent.click(screen.getByRole("menuitem", {name:"Super scale"}));
    expect(screen.getByText("Super scale grid matching")).toBeInTheDocument();
  });

  it("offers text editing through the wheel without opening a competing text editor or context menu", () => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "foremanhq:drawing-quick-wheel:guest" ? "on" : null });
    const note = existingMarkup();
    if (note.kind === "markup") note.data = { ...note.data, type: "text", text: "Test note", points: [{ x: 0.2, y: 0.2 }] };
    mocks.data!.entities = [note];
    open();
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    act(() => props.onQuickWheelSelect?.(entityId));
    expect(screen.queryByRole("textbox", { name: "Text" })).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "Edit text" }));
    expect(screen.getByRole("textbox", { name: "Text" })).toHaveValue("Test note");
  });

  it("opens the employee's drawing tools with a simulation-scoped cache", () => {
    mocks.account = {
      userId: "tim",
      accountKey: "org:tim:simulation:session-id",
      store: null,
    };
    open();
    expect(screen.getByTestId("markup-editor")).toBeVisible();
    expect(
      screen.queryByText("Loading drawing tools…"),
    ).not.toBeInTheDocument();
  });
  it("explains an account mismatch instead of waiting indefinitely", () => {
    mocks.account = {
      userId: "another-employee",
      accountKey: "org:another-employee:simulation:session-id",
      store: null,
    };
    open();
    expect(screen.queryByTestId("markup-editor")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your drawing account changed. Reload to continue.",
    );
    expect(
      screen.getByRole("button", { name: "Reload session" }),
    ).toBeVisible();
  });
  it("pins a snapshot to its captured revision when the current drawing changes", () => {
    mocks.data!.metadata.currentSourceSheetId = revisionId;
    const saved = makeSnapshotSource(
      "/dashboard",
      {
        version: 1,
        drawing: {
          jobId,
          sheetId,
          setId: jobId,
          sourceSheetId: sheetId,
          viewport: { center: { x: 0.2, y: 0.7 }, zoom: 3 },
          appearance: { inverted: true, lineColor: "#336699" },
          layers: {
            markups: false,
            issues: true,
            private: false,
            published: true,
          },
          selectedId: null,
        },
      },
      "A101",
    );
    window.history.replaceState(null, "", saved.href);
    open();
    expect(screen.getByTestId("viewer-source")).toHaveTextContent(sheetId);
    expect(screen.getByTestId("viewer-source")).not.toHaveTextContent(
      revisionId,
    );
  });
  it("explains a missing snapshot revision before offering the current drawing", () => {
    const saved = makeSnapshotSource(
      "/dashboard",
      {
        version: 1,
        drawing: {
          jobId,
          sheetId,
          setId: jobId,
          sourceSheetId: revisionId,
          viewport: { center: { x: 0.5, y: 0.5 }, zoom: 1 },
          appearance: { inverted: false, lineColor: null },
          layers: {
            markups: true,
            issues: true,
            private: true,
            published: true,
          },
          selectedId: null,
        },
      },
      "A101",
    );
    mocks.data!.jobSheets = mocks.data!.jobSheets.filter(
      (item) => item.id !== revisionId,
    );
    window.history.replaceState(null, "", saved.href);
    open();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "snapshot is unavailable",
    );
    expect(screen.queryByTestId("viewer-source")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open the current drawing" }),
    );
    expect(screen.getByTestId("viewer-source")).toHaveTextContent(sheetId);
  });
  it("shows multiple destinations without opening one until it is chosen", () => {
    const entity = existingMarkup();
    if (entity.kind !== "markup") throw Error("fixture");
    entity.data = {
      ...entity.data,
      type: "link",
      text: "AHU-1",
      linkAppearance: "highlight",
      links: [
        { label: "Equipment manual", url: "https://example.com/manual" },
        { label: "Revision drawing", targetSheetId: revisionId },
      ],
    };
    mocks.data!.entities = [entity];
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const onOpenSheet = vi.fn();
    render(
      <DrawingWorkspace
        jobId={jobId}
        sheet={sheet}
        onOpenSheet={onOpenSheet}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tap hyperlink" }));
    expect(screen.getByRole("dialog", { name: "AHU-1" })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    expect(onOpenSheet).not.toHaveBeenCalled();
    const destination = screen.getByRole("button", { name: "Equipment manual" });
    fireEvent.click(destination, { detail: 1 });
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "AHU-1" })).toBeInTheDocument();
    fireEvent.pointerDown(destination, { pointerId: 2, pointerType: "touch" });
    fireEvent.click(destination, { detail: 1 });
    expect(open).toHaveBeenCalledWith(
      "https://example.com/manual",
      "_blank",
      "noopener,noreferrer",
    );
    fireEvent.click(screen.getByRole("button", { name: "Tap hyperlink" }));
    fireEvent.click(screen.getByRole("button", { name: "Revision drawing" }));
    const target = mocks.data!.jobSheets.find(s=>s.id===revisionId)!;
    expect(mocks.push).toHaveBeenLastCalledWith(`/dashboard/jobs/${jobId}/drawings?drawingSet=${target.setId}&drawingSheet=${revisionId}`,{scroll:false});
  });
  it("opens single and legacy hyperlinks directly", () => {
    const entity = existingMarkup();
    if (entity.kind !== "markup") throw Error("fixture");
    entity.data = {
      ...entity.data,
      type: "link",
      href: "https://example.com/legacy",
    };
    mocks.data!.entities = [entity];
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = render(
      <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tap hyperlink" }));
    expect(open).toHaveBeenLastCalledWith(
      "https://example.com/legacy",
      "_blank",
      "noopener,noreferrer",
    );
    entity.data = {
      ...entity.data,
      links: [{ label: "Chat", url: `/dashboard/jobs/${jobId}/chat` }],
    };
    view.rerender(
      <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tap hyperlink" }));
    expect(mocks.push).toHaveBeenLastCalledWith(`/dashboard/jobs/${jobId}/chat`, { scroll: false });
    expect(open).toHaveBeenCalledTimes(1);
    const destinationEvent = vi.fn();
    window.addEventListener(DRAWING_DESTINATION_EVENT,destinationEvent);
    entity.data.links = [{ label: "Drawing", url: `${location.origin}/dashboard/jobs/${jobId}/drawings?drawingSheet=${sheetId}#detail` }];
    view.rerender(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tap hyperlink" }));
    expect(mocks.push).toHaveBeenLastCalledWith(`/dashboard/jobs/${jobId}/drawings?drawingSheet=${sheetId}#detail`, { scroll: false });
    expect(open).toHaveBeenCalledTimes(1);
    expect(destinationEvent).toHaveBeenCalledWith(expect.objectContaining({detail:entity.data.links[0]!.url}));
    window.removeEventListener(DRAWING_DESTINATION_EVENT,destinationEvent);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("creates highlight hyperlinks and persists a named destination list", async () => {
    render(
      <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
    );
    chooseTool("link");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    expect(screen.getByLabelText("Hyperlink appearance")).toHaveValue(
      "highlight",
    );
    fireEvent.change(screen.getByLabelText("Hyperlink name"), {
      target: { value: "AHU-1" },
    });
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "https://example.com/manual" },
    });
    fireEvent.change(screen.getByLabelText("Link name (optional)"), {
      target: { value: "Equipment manual" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: `/dashboard/jobs/${jobId}/chat` },
    });
    fireEvent.change(screen.getByLabelText("Link name (optional)"), {
      target: { value: "Job discussion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      kind: "markup",
      data: {
        type: "link",
        linkAppearance: "highlight",
        opacity: 0.35,
        text: "AHU-1",
        links: [
          { label: "Equipment manual", url: "https://example.com/manual" },
          { label: "Job discussion", url: `/dashboard/jobs/${jobId}/chat` },
        ],
      },
    });
  });
  it("reopens a saved chooser from a PDF address without opening a destination automatically", async () => {
    const entity = existingMarkup();
    if (entity.kind !== "markup") throw Error("fixture");
    entity.data = {
      ...entity.data,
      type: "link",
      text: "AHU-1",
      links: [
        { label: "Manual", url: "https://example.com" },
        { label: "Drawing", targetSheetId: revisionId },
      ],
    };
    mocks.data!.entities = [entity];
    window.history.replaceState(null, "", `/?drawingLink=${entity.id}`);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
    );
    expect(
      await screen.findByRole("dialog", { name: "AHU-1" }),
    ).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
  it("follows original uploaded page links without creating editable markups", () => {
    const base = `/api/job-rooms/files/${jobId}/${sheetId}`;
    mocks.data!.jobSheets[0]!.imageUrl = `${base}/floor-1.webp`;
    mocks.data!.jobSheets[1]!.imageUrl = `${base}/floor-2.webp`;
    const onOpenSheet = vi.fn();
    render(
      <DrawingWorkspace
        jobId={jobId}
        sheet={sheet}
        onOpenSheet={onOpenSheet}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Follow original page link" }),
    );
    const target = mocks.data!.jobSheets[1]!;
    expect(mocks.push).toHaveBeenLastCalledWith(`/dashboard/jobs/${jobId}/drawings?drawingSet=${target.setId}&drawingSheet=${target.id}`,{scroll:false});
    expect(onOpenSheet).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("opens original web links using their retained protocol", () => {
    const browser = vi.spyOn(window, "open").mockReturnValue(null);
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Follow original web link" }),
    );
    expect(browser).toHaveBeenCalledExactlyOnceWith(
      "http://example.com/drawing",
      "_blank",
      "noopener,noreferrer",
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("explains when an original linked page is absent from this job", () => {
    mocks.data!.jobSheets[0]!.imageUrl = `/api/job-rooms/files/${jobId}/${sheetId}/floor-1.webp`;
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Follow original page link" }),
    );
    expect(
      screen.getByText("That linked page has not been added to this job."),
    ).toBeInTheDocument();
  });
  it("opens an ordered stack from the job picker and edits its selected layers", () => {
    const third = "53cfe8af-e26a-49f2-b2dc-ef0d4e0ecb24",
      fourth = "63cfe8af-e26a-49f2-b2dc-ef0d4e0ecb24";
    mocks.data!.jobSheets.push(
      ...[third, fourth].map((id, i) => ({
        ...mocks.data!.jobSheets[0]!,
        id,
        sheetId: id,
        name: `Drawing ${i + 3}`,
      })),
    );
    open();
    openMenu("More");
    fireEvent.click(screen.getByRole("menuitem", { name: "Overlay drawings" }));
    document
      .querySelectorAll("details")
      .forEach((group) => (group.open = true));
    fireEvent.click(screen.getByLabelText("A101 revision 2"));
    fireEvent.click(screen.getByLabelText("Drawing 4"));
    fireEvent.click(screen.getByLabelText("Drawing 3"));
    fireEvent.click(screen.getByRole("button", { name: "Open overlay" }));
    expect(screen.getByTestId("comparison")).toHaveAttribute(
      "data-additional",
      JSON.stringify([fourth, third]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose Drawings" }));
    document
      .querySelectorAll("details")
      .forEach((group) => (group.open = true));
    fireEvent.click(screen.getByLabelText("Drawing 4"));
    fireEvent.click(screen.getByRole("button", { name: "Open overlay" }));
    expect(screen.getByTestId("comparison")).toHaveAttribute(
      "data-additional",
      JSON.stringify([third]),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.metadata).not.toHaveBeenCalled();
  });

  it("keeps the active tool name and finishes it from the same button", () => {
    open();
    const toolbar=screen.getByRole("toolbar",{name:"Drawing tools"});
    for(const id of ["select","line","rect","link"]) {
      chooseTool(id);
      const label=tools.find(([tool])=>tool===id)![1];
      const button=within(toolbar).getByRole("button",{name:label,pressed:true});
      expect(button).toHaveTextContent(label);
      expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool",id);
      expect(within(toolbar).queryByRole("button",{name:"Done"})).toBeNull();
      fireEvent.click(button);
      expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool","pan");
    }
  });
  it("keeps chooser names while open and closes them from the same button",()=>{
    open(); const toolbar=screen.getByRole("toolbar",{name:"Drawing tools"});
    for(const name of ["More","Tools","Markup"]) {
      if(name==="Markup")fireEvent.click(within(toolbar).getByRole("button",{name}));else openMenu(name);
      const button=within(toolbar).getByRole("button",{name});
      expect(button).toHaveClass("bg-primary");expect(button).toHaveAttribute("aria-expanded","true");
      if(name==="Markup")fireEvent.click(button);else fireEvent.keyDown(button,{key:"Enter"});
      expect(screen.queryByRole("menu")).toBeNull();expect(screen.queryByRole("dialog",{name:"Markup tools"})).toBeNull();
      expect(button).not.toHaveClass("bg-primary");
    }
  });
  it("keeps More named More while a panel is open and closes it from that button",()=>{
    open(); panel("details");const toolbar=screen.getByRole("toolbar",{name:"Drawing tools"});
    expect(screen.getByRole("heading",{name:"Sheet details"})).toBeVisible();
    const button=within(toolbar).getByRole("button",{name:"More",pressed:true});
    fireEvent.click(button);expect(screen.queryByRole("heading",{name:"Sheet details"})).toBeNull();
    expect(within(toolbar).getByRole("button",{name:"More"})).toBeVisible();
  });
  it("retains active names when switching between markup, measure and pipe",()=>{
    open();chooseTool("line");const toolbar=screen.getByRole("toolbar",{name:"Drawing tools"});
    fireEvent.click(within(toolbar).getByRole("button",{name:"Measure"}));
    expect(within(toolbar).getByRole("button",{name:"Measure",pressed:true})).toBeVisible();
    expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool","pan");
    openMenu("Tools");fireEvent.click(screen.getByRole("menuitemcheckbox",{name:"Pipe system"}));
    expect(within(toolbar).getByRole("button",{name:"Pipe system",pressed:true})).toBeVisible();
    fireEvent.click(within(toolbar).getByRole("button",{name:"Markup"}));
    expect(screen.getByRole("dialog",{name:"Markup tools"})).toBeVisible();
    fireEvent.click(within(toolbar).getByRole("button",{name:"Measure"}));
    expect(screen.queryByRole("dialog",{name:"Markup tools"})).toBeNull();
    fireEvent.click(within(toolbar).getByRole("button",{name:"Measure",pressed:true}));
    expect(within(toolbar).getByRole("button",{name:"Measure",pressed:false})).toBeVisible();
    expect(within(toolbar).queryByRole("button",{name:"Done"})).toBeNull();
  });

  it("overlays any job drawing pair for read-only users and returns to the original drawing with the comparison viewport", () => {
    mocks.data!.canManage = false;
    const third = "53cfe8af-e26a-49f2-b2dc-ef0d4e0ecb24";
    mocks.data!.jobSheets.push({
      ...mocks.data!.jobSheets[0]!,
      id: third,
      sheetId: third,
      name: "M201",
      setId: third,
    });
    const onViewportChange = vi.fn();
    render(
      <DrawingWorkspace
        jobId={jobId}
        sheet={sheet}
        onOpenSheet={vi.fn()}
        onViewportChange={onViewportChange}
      />,
    );
    openMenu("More");
    fireEvent.click(screen.getByRole("menuitem", { name: "Overlay drawings" }));
    document
      .querySelectorAll("details")
      .forEach((group) => (group.open = true));
    fireEvent.click(screen.getByLabelText(sheet.name));
    fireEvent.click(screen.getByLabelText("A101 revision 2"));
    fireEvent.click(
      screen.getByLabelText(
        mocks.data!.jobSheets.find((item) => item.id === third)!.name,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open overlay" }));
    expect(screen.getByTestId("comparison")).toHaveAttribute(
      "data-first",
      revisionId,
    );
    expect(screen.getByTestId("comparison")).toHaveAttribute(
      "data-second",
      third,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pan overlay" }));
    expect(onViewportChange).toHaveBeenCalledWith({
      center: { x: 0.8, y: 0.6 },
      zoom: 4,
    });
    fireEvent.click(screen.getByRole("button", { name: "Close comparison" }));
    expect(screen.getByTestId("viewer-source")).toHaveTextContent(sheetId);
    expect(screen.getByTestId("inherited-viewport")).toHaveTextContent(
      JSON.stringify({ center: { x: 0.8, y: 0.6 }, zoom: 4 }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.metadata).not.toHaveBeenCalled();
  });
  it("passes inherited view to the viewer, reports raw pan for navigation, and bounds only saved bookmarks", async () => {
    const initialViewport = { center: { x: 0.3, y: 0.7 }, zoom: 3 };
    const onViewportChange = vi.fn();
    render(
      <DrawingWorkspace
        jobId={jobId}
        sheet={sheet}
        onOpenSheet={vi.fn()}
        initialViewport={initialViewport}
        onViewportChange={onViewportChange}
      />,
    );
    expect(screen.getByTestId("inherited-viewport")).toHaveTextContent(
      JSON.stringify(initialViewport),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pan beyond sheet" }));
    expect(onViewportChange).toHaveBeenCalledWith({
      center: { x: 0.2, y: 1.1 },
      zoom: 2,
    });
    panel("views");
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    fireEvent.change(screen.getByLabelText("Saved view name"), {
      target: { value: "My view" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    const saved = mocks.save.mock.calls[0]![0];
    expect(saved.kind).toBe("view");
    if (saved.kind === "view") {
      expect(saved.data.center).toEqual({ x: 0.2, y: 1 });
      expect(saved.data.zoom).toBe(2);
    }
  });

  it("keeps the canvas available after selecting a markup and exposes move, resize, and delete", async () => {
    mocks.data!.entities = [existingMarkup()];
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Select first annotation" }),
    );
    expect(
      screen.getByRole("toolbar", { name: "Selected markup actions" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Drawing tools panel")).toBeNull();
    // Edits unlock once the pickup shake has finished.
    expect(
      await screen.findByRole("button", { name: "Resize" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByTestId("markup-editor")).toHaveAttribute(
      "data-selection-mode",
      "move",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move selected annotation" }),
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    const saved = mocks.save.mock.calls[0]![0];
    expect(saved.id).toBe(entityId);
    expect(saved.expectedRevision).toBe(4);
    if (saved.kind !== "markup") throw Error("Expected a saved markup");
    expect(saved.data.points).toEqual([
      { x: 0.3, y: 0.3 },
      { x: 0.6, y: 0.6 },
    ]);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Saved"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByLabelText("Drawing tools panel")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Resize" }));
    expect(screen.queryByLabelText("Drawing tools panel")).toBeNull();
    expect(screen.getByTestId("markup-editor")).toHaveAttribute(
      "data-selection-mode",
      "resize",
    );
    mocks.archive.mockResolvedValueOnce({
      ...mocks.data!.entities[0],
      visibility: "archived",
      revision: 6,
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete markup" }));
    await waitFor(() =>
      expect(mocks.archive).toHaveBeenCalledWith({
        sheetId,
        id: entityId,
        expectedRevision: 5,
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("toolbar", { name: "Selected markup actions" }),
      ).toBeNull(),
    );
  });
  it("shows read-only selection without move, resize, delete, or unsaved previews", () => {
    mocks.data!.canManage = false;
    mocks.data!.entities = [
      {
        ...existingMarkup("published"),
        authorId: "other",
        authorName: "Other",
      },
    ];
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Select first annotation" }),
    );
    expect(screen.getByText("Read only")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete markup" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Move selected annotation" }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(
      within(
        screen.getByRole("toolbar", { name: "Selected markup actions" }),
      ).queryByRole("button", { name: "Done" }),
    ).toBeNull();
    fireEvent.click(
      within(screen.getByRole("toolbar", { name: "Drawing tools" })).getByRole(
        "button",
        { name: "Select" },
      ),
    );
    expect(
      screen.queryByRole("toolbar", { name: "Selected markup actions" }),
    ).toBeNull();
    expect(screen.getByTestId("markup-editor")).toHaveAttribute(
      "data-tool",
      "pan",
    );
  });
  it("aborts old OCR and discards its words after changing source revision", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const view = open();
    panel("search");
    fireEvent.click(
      screen.getByRole("button", { name: "Recognize scanned text" }),
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    mocks.data = {
      ...mocks.data!,
      metadata: { ...mocks.data!.metadata, currentSourceSheetId: revisionId },
    };
    view.rerender(
      <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
    );
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      finish(
        new Response(
          JSON.stringify({
            words: [
              {
                text: "STALE SOURCE",
                left: 0,
                top: 0,
                right: 0.1,
                bottom: 0.1,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    expect(screen.getByTestId("reference-words")).toBeEmptyDOMElement();
    vi.unstubAllGlobals();
  });
  it("autosaves a drawn shape publicly on its immutable source with a new revision", async () => {
    open();
    chooseTool("rect");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      sheetId,
      expectedRevision: 0,
      visibility: "published",
      kind: "markup",
      data: { sourceSheetId: sheetId, type: "rect" },
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Saved"),
    );
  });
  it("uses the personal Private default for new shapes, text and hyperlink drafts", async () => {
    mocks.data!.canManage = false;
    open();
    openMenu("More");
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Private · only me" }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    chooseTool("rect");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      visibility: "private",
      kind: "markup",
    });
    chooseTool("text");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: "Personal note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done editing text" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]![0]).toMatchObject({
      visibility: "private",
      data: { type: "text" },
    });
    chooseTool("link");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    expect(screen.getByLabelText("Visibility")).toHaveValue("private");
  });
  it("uses Private for a new measurement while preserving an existing public markup on edit", async () => {
    mocks.data!.entities = [existingMarkup("published")];
    open();
    openMenu("More");
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Private · only me" }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Move selected annotation" }),
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      visibility: "published",
      expectedRevision: 4,
    });
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<
      typeof DrawingSheetViewer
    >;
    act(() => {
      props.onMeasurementComplete?.({
        sourceSheetId: sheetId,
        type: "dimension",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.4, y: 0.4 },
        ],
        stroke: "#ef4444",
        width: 2,
      });
    });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]![0]).toMatchObject({
      visibility: "private",
      expectedRevision: 0,
      data: { type: "dimension" },
    });
  });
  it("types a worker's text markup in place and saves it to the job team; links keep their form", async () => {
    mocks.data!.canManage = false;
    open();
    chooseTool("text");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    expect(screen.queryByLabelText("Note / label")).toBeNull();
    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: "Crew note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done editing text" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      kind: "markup",
      visibility: "published",
      data: expect.objectContaining({ type: "text", text: "Crew note" }),
    });
    expect(screen.queryByLabelText("Text")).toBeNull();
    chooseTool("link");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    expect(screen.getByLabelText("Visibility")).toHaveValue("published");
  });
  it("discards an empty new text note without saving", () => {
    open();
    chooseTool("text");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    fireEvent.click(screen.getByRole("button", { name: "Done editing text" }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Text")).toBeNull();
  });
  it("reopens a selected text note in the in-place editor", () => {
    const note = existingMarkup("published");
    mocks.data!.entities = [
      {
        ...note,
        data: {
          ...note.data,
          type: "text",
          text: "Old note",
          points: [{ x: 0.2, y: 0.2 }],
        },
      } as DrawingEntity,
    ];
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Select first annotation" }),
    );
    expect(screen.getByLabelText("Text")).toHaveValue("Old note");
    expect(
      screen.queryByRole("toolbar", { name: "Selected markup actions" }),
    ).toBeNull();
  });
  it("removes a saved measurement through Clear using its revision", async () => {
    const entity=existingMarkup("published");
    mocks.data!.entities=[{...entity,data:{...entity.data,type:"dimension",parents:[null,0],points:[{x:.2,y:.2},{x:.5,y:.2}]}} as DrawingEntity];
    mocks.archive.mockResolvedValueOnce({...mocks.data!.entities[0],visibility:"archived",revision:5});
    open();
    const viewer=mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    let removed:boolean|undefined;
    await act(async()=>{removed=await viewer.onRemoveMeasurement?.(entity.id);});
    expect(removed).toBe(true);
    expect(mocks.archive).toHaveBeenCalledWith({sheetId,id:entity.id,expectedRevision:4});
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("selects a measurement normally and resumes only from Edit", async () => {
    const entity=existingMarkup("published");
    mocks.data!.entities=[{...entity,data:{...entity.data,type:"dimension",parents:[null,0],points:[{x:.2,y:.2},{x:.5,y:.2}],unit:"m",scale:100}} as DrawingEntity];
    open();
    fireEvent.click(screen.getByRole("button",{name:"Select first annotation"}));
    const actions=await screen.findByRole("toolbar",{name:"Selected markup actions"});
    expect(mocks.viewer.mock.lastCall?.[0]).toMatchObject({selectedId:entity.id,editMeasurementRequest:null});
    fireEvent.click(await within(actions).findByRole("button",{name:"Edit"}));
    expect(mocks.viewer.mock.lastCall?.[0]).toMatchObject({editMeasurementRequest:{entityId:entity.id}});
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("right-clicking a measurement selects it and offers the bar's actions at the cursor", async () => {
    const entity=existingMarkup("published");
    mocks.data!.entities=[{...entity,data:{...entity.data,type:"dimension",parents:[null,0],points:[{x:.2,y:.2},{x:.5,y:.2}],unit:"m",scale:100}} as DrawingEntity];
    open();
    const viewer=()=>mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    act(()=>viewer().onContextMenu?.(entity.id,{x:120,y:80}));
    expect(viewer()).toMatchObject({selectedId:entity.id,tool:"select"});
    const menu=await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map(item=>item.textContent)).toEqual(["Move","Resize","Edit","Details","Delete"]);
    fireEvent.click(within(menu).getByRole("menuitem",{name:"Move"}));
    await waitFor(()=>expect(screen.queryByRole("menu")).toBeNull());
    expect(viewer()).toMatchObject({selectedId:entity.id,selectionMode:"move"});
    act(()=>viewer().onContextMenu?.(entity.id,{x:120,y:80}));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem",{name:"Edit"}));
    await waitFor(()=>expect(viewer()).toMatchObject({editMeasurementRequest:{entityId:entity.id}}));
    act(()=>viewer().onContextMenu?.(null,{x:10,y:10}));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("offers a selected markup's drawing style and saves a change", async () => {
    mocks.data!.entities = [existingMarkup("published")];
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Select first annotation" }),
    );
    const style = await screen.findByRole("group", { name: "Markup style" });
    fireEvent.click(within(style).getByRole("button", { name: "Blue" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      kind: "markup",
      expectedRevision: 4,
      data: expect.objectContaining({ stroke: "#2563eb" }),
    });
  });
  it("lets a worker edit their own public markup", async () => {
    mocks.data!.canManage = false;
    mocks.data!.entities = [existingMarkup("published")];
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Select first annotation" }),
    );
    // Edits unlock once the pickup shake has finished.
    expect(await screen.findByRole("button", { name: "Move" })).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Move selected annotation" }),
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      visibility: "published",
      expectedRevision: 4,
    });
  });
  it("does not discard a note being typed when an earlier pen save finishes", async () => {
    let complete!: (value: DrawingEntity) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    open();
    chooseTool("rect");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    chooseTool("text");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: "Keep this note" },
    });
    const original = mocks.save.mock.calls[0]![0];
    await act(async () =>
      complete({
        id: original.id,
        sheetId,
        kind: "markup",
        data: original.data,
        visibility: "private",
        revision: 1,
        authorId: "tim",
        authorName: "Tim",
        createdAt: "",
        updatedAt: "",
        comments: [],
      } as DrawingEntity),
    );
    expect(screen.getByLabelText("Text")).toHaveValue("Keep this note");
  });
  it("preserves unsaved geometry after a server failure for a visible retry", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Connection interrupted"));
    open();
    chooseTool("rect");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Connection interrupted",
      ),
    );
    expect(
      screen.getByText("1 unsaved item(s) kept on this screen."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]![0].id).toBe(
      mocks.save.mock.calls[0]![0].id,
    );
  });
  it("acknowledges shared calibration only after saving and cancels stale reads before updating the scale", async () => {
    let finish!: (value: Workspace["metadata"]) => void;
    mocks.metadata.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
    );
    openMenu("More");
    fireEvent.click(screen.getByRole("menuitem", { name: "Super scale" }));
      fireEvent.click(screen.getByRole("button", { name: "Start new Super scale" }));
    fireEvent.click(screen.getByRole("button", { name: "Set scale" }));
    fireEvent.click(screen.getByRole("button", { name: "Calibrate sample" }));
    await waitFor(() => expect(mocks.metadata).toHaveBeenCalledOnce());
    expect(mocks.scaleResult).not.toHaveBeenCalled();
    expect(screen.getByTestId("shared-scale")).toHaveTextContent("unset");
    await act(async () =>
      finish({
        ...fixture().metadata,
        scale: { unit: "m", unitsPerSheetWidth: 120 },
        revision: 8,
      }),
    );
    expect(mocks.cancel).toHaveBeenCalledWith({ sheetId });
    expect(mocks.scaleResult).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("shared-scale")).toHaveTextContent("120");
  });

  it("rejects shared calibration when saving fails", async () => {
    mocks.metadata.mockRejectedValueOnce(new Error("Connection lost"));
    render(
      <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
    );
    openMenu("More");
    fireEvent.click(screen.getByRole("menuitem", { name: "Super scale" }));
      fireEvent.click(screen.getByRole("button", { name: "Start new Super scale" }));
    fireEvent.click(screen.getByRole("button", { name: "Set scale" }));
    fireEvent.click(screen.getByRole("button", { name: "Calibrate sample" }));
    await waitFor(() => expect(mocks.scaleResult).toHaveBeenCalledWith(false));
    expect(screen.getByTestId("shared-scale")).toHaveTextContent("unset");
  });

  it("Set scale changes the shared scale for everyone, without needing manager rights", async () => {
    mocks.data = { ...fixture(), canManage: false };
    mocks.data.metadata.scale = {unit: "m", unitsPerSheetWidth: 80};
    render(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Calibrate sample" }));
    await waitFor(() => expect(mocks.setScale).toHaveBeenCalledWith({sheetId, scale: {unit:"m", unitsPerSheetWidth:120}}));
    await waitFor(() => expect(mocks.scaleResult).toHaveBeenCalledWith(true));
    expect(mocks.metadata).not.toHaveBeenCalled();
    expect(mocks.data.metadata.scale?.unitsPerSheetWidth).toBe(120);
    expect(screen.getByTestId("shared-scale")).toHaveTextContent("120");
  });
  it("reports a failed shared scale save and keeps the previous scale", async () => {
    mocks.data!.metadata.scale = {unit: "m", unitsPerSheetWidth: 80};
    mocks.setScale.mockRejectedValueOnce(new Error("Connection lost"));
    render(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Calibrate sample" }));
    await waitFor(() => expect(mocks.scaleResult).toHaveBeenCalledWith(false));
    expect(screen.getByTestId("shared-scale")).toHaveTextContent("80");
    expect(await screen.findByText("Connection lost")).toBeTruthy();
  });

  it("keeps local metadata edits during refresh and submits their original expected revision", async () => {
    const view = open();
    panel("details");
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Local title" },
    });
    mocks.data = {
      ...mocks.data!,
      metadata: {
        ...mocks.data!.metadata,
        revision: 8,
        title: "Other user's title",
      },
    };
    view.rerender(
      <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
    );
    expect(screen.getByLabelText("Title")).toHaveValue("Local title");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    fireEvent.change(screen.getByLabelText("Tags (comma separated)"), {
      target: { value: "plumbing, rough in" },
    });
    expect(screen.getByLabelText("Tags (comma separated)")).toHaveValue(
      "plumbing, rough in",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() =>
      expect(mocks.metadata.mock.calls[0]?.[0] as unknown).toMatchObject({
        expectedRevision: 7,
        data: { title: "Local title", tags: ["plumbing", "rough in"] },
      }),
    );
  });
  it("protects metadata fields while their save is in flight", async () => {
    let finish!: (value: Workspace["metadata"]) => void;
    mocks.metadata.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    open();
    panel("details");
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Checked title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(mocks.metadata).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Tags (comma separated)")).toBeDisabled();
    await act(async () =>
      finish({ ...fixture().metadata, revision: 8, title: "Checked title" }),
    );
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(screen.getByLabelText("Title")).toHaveValue("Checked title");
  });
  it("requests an assigned review and records the current metadata revision", async () => {
    open();
    panel("reviews");
    fireEvent.click(screen.getByRole("button", { name: "Request review" }));
    fireEvent.change(screen.getByLabelText("Reviewer"), {
      target: { value: "chris" },
    });
    fireEvent.change(screen.getByLabelText("Review notes"), {
      target: { value: "Check the mechanical layout" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      kind: "review",
      visibility: "published",
      expectedMetadataRevision: 7,
      data: {
        sourceSheetId: sheetId,
        status: "pending",
        reviewerId: "chris",
        body: "Check the mechanical layout",
      },
    });
  });
  it("shows only response fields to an assignee who cannot edit the issue details", () => {
    mocks.data!.canManage = false;
    mocks.data!.entities = [
      {
        id: entityId,
        sheetId,
        kind: "issue",
        revision: 3,
        visibility: "published",
        authorId: "chris",
        authorName: "Chris",
        createdAt: "",
        updatedAt: "",
        comments: [],
        data: {
          sourceSheetId: sheetId,
          type: "rfi",
          point: { x: 0.5, y: 0.5 },
          title: "Confirm size",
          body: "Which pipe?",
          status: "open",
          assigneeId: "tim",
          dueDate: null,
          links: [],
        },
      },
    ];
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Select first annotation" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Question / response")).toHaveValue(
      "Which pipe?",
    );
    expect(screen.queryByLabelText("RFI subject")).toBeNull();
    expect(screen.queryByLabelText("Assigned to")).toBeNull();
    expect(screen.queryByLabelText("Visibility")).toBeNull();
  });
});

it("reuses saved annotation geometry and callbacks when opening an unrelated tools panel", () => {
  open();
  const before = mocks.viewer.mock.calls.at(-1)![0] as ComponentProps<
    typeof DrawingSheetViewer
  >;
  panel("details");
  const after = mocks.viewer.mock.calls.at(-1)![0] as ComponentProps<
    typeof DrawingSheetViewer
  >;
  expect(after.annotations).toBe(before.annotations);
  expect(after.onSelect).toBe(before.onSelect);
  expect(after.onActivate).toBe(before.onActivate);
  expect(after.canEditAnnotation).toBe(before.canEditAnnotation);
});

it("reviews possible revision impacts in a focused comparison without editing the original markup", async () => {
  mocks.data!.entities = [
    {
      id: entityId,
      sheetId,
      kind: "issue",
      revision: 1,
      visibility: "published",
      authorId: "tim",
      authorName: "Tim",
      comments: [],
      createdAt: "",
      updatedAt: "",
      data: {
        sourceSheetId: sheetId,
        type: "issue",
        point: { x: 0.3, y: 0.4 },
        title: "Needs review: pipe takeoff",
        body: "Alignment could not be verified. Possible impact only.",
        status: "open",
        assigneeId: "tim",
        dueDate: null,
        links: [],
        revisionImpact: {
          previousSourceSheetId: revisionId,
          affectedId: "takeoff-line",
          affectedKind: "takeoff",
          alignmentVerified: false,
        },
      },
    },
  ];
  render(
    <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Needs review (1)" }));
  expect(
    screen.getByText(/Possible impacts, not confirmed errors/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Compare before / after" }),
  );
  expect(screen.getByTestId("comparison")).toHaveAttribute(
    "data-first",
    revisionId,
  );
  expect(
    JSON.parse(screen.getByTestId("comparison").getAttribute("data-focus")!),
  ).toEqual({ center: { x: 0.3, y: 0.4 }, zoom: 3 });
  fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
  const saved = mocks.save.mock.calls[0]![0];
  expect(saved.id).toBe(entityId);
  expect(saved.kind).toBe("issue");
  if (saved.kind === "issue") expect(saved.data.status).toBe("closed");
  expect(mocks.save.mock.calls.every(([value]) => value.kind === "issue")).toBe(
    true,
  );
});

it("keeps the scrolling drawing toolbar in the host dock and its controls working", () => {
  const dock = document.createElement("div");
  document.body.append(dock);
  const view = render(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} scrollPages toolbarContainer={dock} />);
  expect(within(view.container).queryByRole("button", { name: "Measure" })).toBeNull();
  fireEvent.click(within(dock).getByRole("button", { name: "Measure" }));
  expect(within(dock).getByRole("button", { name: "Measure", pressed:true })).toBeVisible();
  fireEvent.click(within(dock).getByRole("button", { name: "Markup" }));
  expect(within(dock).getByRole("dialog", { name: "Markup tools" })).toBeVisible();
  view.unmount();
  expect(dock).toBeEmptyDOMElement();
  dock.remove();
});

it("remembers the captured source drawing view before following an internal hyperlink",()=>{
 const entity=existingMarkup();
 if(entity.kind!=="markup")throw Error("fixture");
 entity.data={...entity.data,type:"link",links:[{label:"Documents",url:`/dashboard/jobs/${jobId}/documents`}]};
 mocks.data!.entities=[entity];
 const href=`/dashboard/jobs/${jobId}/drawings?drawingSheet=${sheetId}#snapshot=captured-zoom`;
 const captureSource=vi.fn(()=>({href,title:"Source",capturedAt:new Date().toISOString()}));
 const visit=vi.fn();window.addEventListener(HYPERLINK_VISIT_EVENT,visit);
 render(<SnapshotSourceContext.Provider value={{captureSource,register:()=>()=>{},registerPage:()=>()=>{}}}>
   <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()}/>
 </SnapshotSourceContext.Provider>);
 fireEvent.click(screen.getByRole("button",{name:"Tap hyperlink"}));
 expect(captureSource).toHaveBeenCalledOnce();
 expect(visit).toHaveBeenCalledWith(expect.objectContaining({detail:{source:href,target:new URL(`/dashboard/jobs/${jobId}/documents`,location.origin).href}}));
 window.removeEventListener(HYPERLINK_VISIT_EVENT,visit);
});

it("leaves a completed measurement unselected after its asynchronous save finishes", async () => {
  open();
  const props = mocks.viewer.mock.calls.at(-1)![0] as ComponentProps<typeof DrawingSheetViewer>;
  const dimension = { sourceSheetId: sheetId, type: "dimension" as const, points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }], stroke: "#ff0000", width: 2 };
  act(() => props.onMeasurementComplete?.(dimension));
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
  await waitFor(() => {
    const latest = mocks.viewer.mock.calls.at(-1)![0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(latest.annotations?.some(entity => entity.kind === "markup" && entity.data.type === "dimension")).toBe(true);
    expect(latest.selectedId).toBeNull();
  });
});
