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
import { makeSnapshotSource } from "~/lib/snapshot-source";

const mocks = vi.hoisted(() => ({
  account: null as { userId: string; accountKey: string; store: null } | null,
  data: null as Workspace | null,
  save: vi.fn<(value: DrawingSave) => Promise<DrawingEntity>>(),
  metadata: vi.fn(),
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
vi.mock("./ChatNotifications", () => ({
  ChatNotifications: () => <button>Enable device notifications</button>,
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
      <button onClick={props.onEditDrawings}>Add / remove drawings</button>
    </div>
  ),
}));
vi.mock("./DrawingSheetViewer", () => ({
  DrawingSheetViewer: (props: ComponentProps<typeof DrawingSheetViewer>) => {
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
  const done = within(
    screen.getByRole("toolbar", { name: "Drawing tools" }),
  ).queryByRole("button", { name: "Done" });
  if (done) fireEvent.click(done);
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
  window.history.replaceState(null, "", "/");
});

describe("drawing workspace workflows", () => {
  it("opens the employee's drawing tools with a simulation-scoped cache", () => {
    mocks.account = {
      userId: "tim",
      accountKey: "org:tim:simulation:session-id",
      store: null,
    };
    open();
    expect(screen.getByTestId("markup-editor")).toBeVisible();
    expect(screen.queryByText("Loading drawing tools…")).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Reload session" })).toBeVisible();
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
    fireEvent.click(screen.getByRole("button", { name: "Equipment manual" }));
    expect(open).toHaveBeenCalledWith(
      "https://example.com/manual",
      "_blank",
      "noopener,noreferrer",
    );
    fireEvent.click(screen.getByRole("button", { name: "Tap hyperlink" }));
    fireEvent.click(screen.getByRole("button", { name: "Revision drawing" }));
    expect(onOpenSheet).toHaveBeenCalledWith(
      expect.objectContaining({ id: revisionId }),
    );
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
    expect(open).toHaveBeenLastCalledWith(
      `${location.origin}/dashboard/jobs/${jobId}/chat`,
      "_blank",
      "noopener,noreferrer",
    );
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
    expect(onOpenSheet).toHaveBeenCalledExactlyOnceWith(
      mocks.data!.jobSheets[1],
    );
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
    fireEvent.change(screen.getByLabelText("Drawing B"), {
      target: { value: revisionId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add drawing" }));
    fireEvent.change(screen.getByLabelText("Drawing C"), {
      target: { value: fourth },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add drawing" }));
    fireEvent.change(screen.getByLabelText("Drawing D"), {
      target: { value: third },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open overlay" }));
    expect(screen.getByTestId("comparison")).toHaveAttribute(
      "data-additional",
      JSON.stringify([fourth, third]),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add / remove drawings" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Drawing C" }));
    fireEvent.click(screen.getByRole("button", { name: "Open overlay" }));
    expect(screen.getByTestId("comparison")).toHaveAttribute(
      "data-additional",
      JSON.stringify([third]),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.metadata).not.toHaveBeenCalled();
  });

  it("finishes each bottom tool from its own button and restores normal movement", () => {
    open();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    for (const id of ["pan", "select", "line"]) {
      chooseTool(id);
      expect(screen.getAllByRole("button", { name: "Done" })).toHaveLength(1);
      expect(screen.getByTestId("markup-editor")).toHaveAttribute(
        "data-tool",
        id,
      );
      expect(
        screen.queryByRole("button", {
          name: id === "line" ? "Markup" : "Tools",
        }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(screen.getByTestId("markup-editor")).toHaveAttribute(
        "data-tool",
        "pan",
      );
      expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    }
  });

  it("switches exclusively between markup, measure and pipe, including open choosers", () => {
    open();
    chooseTool("line");
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.getByTestId("markup-editor")).toHaveAttribute(
      "data-tool",
      "pan",
    );
    expect(screen.getAllByRole("button", { name: "Done" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Markup" })).toBeVisible();
    openMenu("Tools");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Pipe system" }),
    );
    expect(screen.getAllByRole("button", { name: "Done" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Tools" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Markup" }));
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Markup tools" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.queryByRole("dialog", { name: "Markup tools" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Measure" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
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
    fireEvent.change(screen.getByLabelText("Drawing A"), {
      target: { value: revisionId },
    });
    fireEvent.change(screen.getByLabelText("Drawing B"), {
      target: { value: third },
    });
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
    expect(screen.getByRole("button", { name: "Resize" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
    mocks.data!.entities = [existingMarkup("published")];
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
    fireEvent.click(
      within(
        screen.getByRole("toolbar", { name: "Selected markup actions" }),
      ).getByRole("button", { name: "Done" }),
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
  it("autosaves a drawn shape privately on its immutable source with a new revision", async () => {
    open();
    chooseTool("rect");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      sheetId,
      expectedRevision: 0,
      visibility: "private",
      kind: "markup",
      data: { sourceSheetId: sheetId, type: "rect" },
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Saved"),
    );
  });
  it("does not discard a new text form when an earlier pen save finishes", async () => {
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
    fireEvent.change(screen.getByLabelText("Note / label"), {
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
    expect(screen.getByLabelText("Note / label")).toHaveValue("Keep this note");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
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
    fireEvent.click(screen.getByRole("button", { name: "Calibrate sample" }));
    await waitFor(() => expect(mocks.scaleResult).toHaveBeenCalledWith(false));
    expect(screen.getByTestId("shared-scale")).toHaveTextContent("unset");
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
