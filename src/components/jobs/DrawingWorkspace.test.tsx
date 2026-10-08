import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DrawingEntity,
  DrawingSave,
  DrawingWorkspace as Workspace,
} from "~/lib/drawing-workspace";
import type { ComponentProps } from "react";
import type { DrawingSheetViewer } from "./DrawingSheetViewer";
import { DrawingWorkspace } from "./DrawingWorkspace";

const mocks = vi.hoisted(() => ({
  data: null as Workspace | null,
  save: vi.fn<(value: DrawingSave) => Promise<DrawingEntity>>(),
  metadata: vi.fn(),
  archive: vi.fn(),
  comment: vi.fn(),
  version: vi.fn(),
  favorite: vi.fn(),
  watch: vi.fn(),
  read: vi.fn(),
  invalidate: vi.fn(async () => undefined),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      drawingsWorkspace: {
        get: {
          invalidate: mocks.invalidate,
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
vi.mock("./DrawingAccountProvider", () => ({ useDrawingAccount: () => null }));
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
  DrawingCompare: () => <div>Comparison</div>,
}));
vi.mock("./DrawingSheetViewer", () => ({
  DrawingSheetViewer: (props: ComponentProps<typeof DrawingSheetViewer>) => (
    <div
      data-testid="markup-editor"
      data-tool={props.tool}
      data-selection-mode={props.selectionMode}
    >
      <div data-testid="viewer-source">
        {props.sourceSheetId ?? props.sheetKey}
      </div>
      <button
        onClick={() =>
          props.onCreate?.({
            sourceSheetId: props.sourceSheetId!,
            type: props.tool === "text" ? "text" : "rect",
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
          const entity = props.annotations?.[0];
          if (entity?.kind === "markup" && props.canEditAnnotation?.(entity.id))
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
  ),
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
const panel = (name: string) =>
  fireEvent.change(screen.getByLabelText("Drawing panel"), {
    target: { value: name },
  });
beforeEach(() => {
  vi.clearAllMocks();
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
});

describe("drawing workspace workflows", () => {
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
    expect(
      screen.queryByRole("button", { name: "Move" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Resize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete markup" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Move selected annotation" }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
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
    fireEvent.change(screen.getByLabelText("Drawing tool"), {
      target: { value: "rect" },
    });
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
    fireEvent.change(screen.getByLabelText("Drawing tool"), {
      target: { value: "rect" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    fireEvent.change(screen.getByLabelText("Drawing tool"), {
      target: { value: "text" },
    });
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
    fireEvent.change(screen.getByLabelText("Drawing tool"), {
      target: { value: "rect" },
    });
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
