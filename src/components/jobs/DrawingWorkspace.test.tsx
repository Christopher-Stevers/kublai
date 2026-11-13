import type * as SharedIssueSaveModule from "~/hooks/use-drawing-shared-issue-save";
import type * as DrawingScaleSaveModule from "~/hooks/use-drawing-scale-save";
import type * as DocumentWorkspaceAuthorityModule from "~/hooks/use-document-workspace-authority";
import type * as InstantSavedViewNameModule from "~/hooks/use-instant-saved-view-name";
import { QueryClient, QueryClientProvider, QueryClientContext, useQuery } from "@tanstack/react-query";
import type { DrawingOfflineStore } from "~/lib/drawing-offline";
import { runHeaderBackOverride, useHeaderBackOverride } from "~/lib/header-back-events";
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
  DrawingMetadata,
  DrawingWorkspace as Workspace,
} from "~/lib/drawing-workspace";
import { Activity, useContext, useEffect, type ComponentProps } from "react";
import type { DrawingSheetViewer } from "./DrawingSheetViewer";
import { DrawingWorkspace, panels, tools } from "./DrawingWorkspace";
import type { DrawingCompare } from "./DrawingCompare";
import { DRAWING_DESTINATION_EVENT, makeSnapshotSource } from "~/lib/snapshot-source";

const mocks = vi.hoisted(() => ({
  instantNames: false,
  realScale: false, realSharedIssue: false, readWorkspace: vi.fn(),
  dropMetadataPatch: false,
  viewer: vi.fn(),
  loadLink: vi.fn(),
  push: vi.fn(),
  linkTargets: (_input: { kind: string; query: string }) => [] as Array<Record<string, unknown>>,
  textSearch: (_input: { kind: string; query: string }) => [] as Array<Record<string, unknown>>,
  account: null as { userId: string; accountKey: string; store: DrawingOfflineStore | null } | null,
  data: null as Workspace | null,
  queryError: null as { message: string; data: { code: string } } | null,
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
    useUtils: () => {const client = useContext(QueryClientContext); return ({
      client: { drawingsWorkspace: { link: { query: mocks.loadLink }, save: {mutate: mocks.save}, get: {query: mocks.readWorkspace}, setScale: {mutate: mocks.setScale} } },
      drawingsWorkspace: {
        get: {
          invalidate: mocks.invalidate,
          cancel: mocks.cancel,
          setData: (
            _: unknown,
            update: (data: Workspace | null) => Workspace | null,
          ) => {
            if (mocks.dropMetadataPatch) return;
            mocks.data = update(mocks.data);
            if (client) client.setQueriesData({queryKey: ["drawing"]}, mocks.data);
          },
        },
        list: { invalidate: mocks.invalidate },
        notifications: { invalidate: mocks.invalidate },
      },
    });},
    drawingsWorkspace: {
      addMeasurementLayer: { useMutation: () => ({ mutateAsync: vi.fn(async () => undefined) }) },
      setScale: { useMutation: () => ({ mutateAsync: mocks.setScale }) },
      textSearch: {
        useQuery: (input: { kind: string; query: string }, options?: { enabled?: boolean }) => ({
          data: options?.enabled === false ? undefined : { hits: mocks.textSearch(input), more: false, unreadable: 0, pending: 0 },
          isFetching: false,
        }),
      },
      linkTargets: {
        useQuery: (input: { kind: string; query: string }) => ({
          data: { jobs: [], targets: mocks.linkTargets(input) },
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
      autoHyperlinkSave: { useMutation: () => ({ mutateAsync: mocks.save }) },
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
function useCachedWorkspaceRead(sheetId: string, hyperlinks: boolean) {
  return useQuery<Workspace>({queryKey: ["drawing", hyperlinks ? {sheetId} : {sheetId, omitHyperlinks: true}], queryFn: async () => mocks.data!, enabled: false});
}
function useStaticWorkspaceRead(_sheetId: string, _hyperlinks: boolean) {
  return {data: mocks.data, error: mocks.queryError, refetch: mocks.invalidate};
}
vi.mock("~/hooks/use-drawing-workspace-query", () => ({
  useDrawingWorkspaceQuery: (sheetId: string, _online: boolean, hyperlinks = true) => {
    // Mode is selected before mount; each fixture keeps one hook implementation.
    const useRead = mocks.instantNames ? useCachedWorkspaceRead : useStaticWorkspaceRead;
    return useRead(sheetId, hyperlinks);
  },
}));

vi.mock("@trpc/react-query", () => ({getQueryKey: (_: unknown, input: unknown) => ["drawing", input]}));
vi.mock("~/hooks/use-document-workspace-authority", async (original) => {
  const actual = await original<typeof DocumentWorkspaceAuthorityModule>();
  return {useDocumentWorkspaceAuthority: (...args: Parameters<typeof actual.useDocumentWorkspaceAuthority>) => mocks.instantNames ? actual.useDocumentWorkspaceAuthority(...args) : {confirmed: false, isCurrent: () => false}};
});
vi.mock("~/hooks/use-instant-saved-view-name", async (original) => {
  const actual = await original<typeof InstantSavedViewNameModule>();
  return {useInstantSavedViewName: (...args: Parameters<typeof actual.useInstantSavedViewName>) => mocks.instantNames ? actual.useInstantSavedViewName(...args) : {tryRename: () => false, canPersist: () => true, isPending: false, pendingEntityId: undefined}};
});

vi.mock("~/hooks/use-drawing-shared-issue-save", async original => {
  const actual=await original<typeof SharedIssueSaveModule>();
  function useFixtureSharedIssue(){return {trySave:()=>null,recover:async()=>undefined,isPending:false,needsRecovery:false,checking:false};}
  return {useDrawingSharedIssueSave:(options:Parameters<typeof actual.useDrawingSharedIssueSave>[0])=>{
    const useSelected=mocks.realSharedIssue?actual.useDrawingSharedIssueSave:useFixtureSharedIssue;
    return useSelected(options);
  }};
});
// Legacy cases retain their old deterministic service; the new parent race
// cases use the actual controller on a fresh QueryClient-backed mount.
vi.mock("~/hooks/use-drawing-scale-save", async original => {
  const actual = await original<typeof DrawingScaleSaveModule>();
  function useFixtureScale(options: Parameters<typeof actual.useDrawingScaleSave>[0]) {
    return { isPending: false, save: async (scale: DrawingMetadata["scale"]) => {
      try { if (!options.canStart()) return false; const next = await (mocks.setScale as (input: unknown) => unknown)({sheetId:options.sheetId,scale}) as DrawingMetadata;
        await (mocks.cancel as (input: unknown) => unknown)({sheetId:options.sheetId});mocks.data = mocks.data ? {...mocks.data,metadata:next} : null;
        options.onAccepted(next);return true;
      } catch (reason) { options.onError(reason);return false; }
    } };
  }
  return {useDrawingScaleSave: (options: Parameters<typeof actual.useDrawingScaleSave>[0]) => {
    const useSelectedHook = mocks.realScale ? actual.useDrawingScaleSave : useFixtureScale;
    return useSelectedHook(options);
  }};
});
vi.mock("./DrawingAccountProvider", () => ({
  useDrawingAccount: () => mocks.account,
}));
vi.mock("./DrawingDocumentActions", () => ({
  DrawingDocumentActions: () => <div>Document actions</div>,
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
        <button onClick={() => props.onSelect?.(mocks.data?.entities.find(entity => entity.kind === "view")?.id ?? null)}>Select saved view</button>
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
    canUseSheetTools: true,
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
const open = (fullscreen = false) =>
  render(
    <DrawingWorkspace fullscreen={fullscreen} jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
  );
function enableHyperlinks() {
  fireEvent.click(screen.getByRole("button", {name:"Layers"}));
  fireEvent.click(screen.getByRole("button", {name:"Hyperlink layer"}));
  fireEvent.click(screen.getByRole("button", {name:"Layers"}));
}
// The bottom bar: panels are in More, markup types in Markup, others in Tools.
const openMenu = (name: string) => {
  if (name === "More" || name === "Tools") {
    const more = screen.getByRole("button", { name: /Expand all actions|Collapse actions/ });
    if (more.getAttribute("aria-expanded") !== "true") fireEvent.click(more);
    return;
  }
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
};
const panel = (name: string) => {
  openMenu("More");
  fireEvent.click(within(screen.getByRole("toolbar", { name: "Drawing tools" })).getByRole("button", {
    name: panels.find(([id]) => id === name)![1],
  }));
};
const chooseTool = (id: string) => {
  const label = tools.find(([tool]) => tool === id)![1];
  const active = within(screen.getByRole("toolbar", {name:"Drawing tools"})).queryAllByRole("button", {pressed:true});
  for (const button of active) fireEvent.click(button);
  if (["pan", "select", "link", "issue", "rfi"].includes(id)) {
    openMenu("Tools");
    fireEvent.click(screen.getByRole("button", { name: label }));
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Markup" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
  }
};
beforeEach(() => {
  mocks.instantNames = false;
  mocks.realScale = false;
  mocks.realSharedIssue = false;
  mocks.dropMetadataPatch = false;
  mocks.queryError = null;
  vi.clearAllMocks();
  mocks.setScale.mockImplementation(async ({scale}: {scale: Workspace["metadata"]["scale"]}) => ({
    ...mocks.data!.metadata, scale, revision: mocks.data!.metadata.revision + 1,
  }));
  mocks.account = null;
  mocks.data = fixture();
  mocks.readWorkspace.mockImplementation(async()=>mocks.data);
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
    fireEvent.click(screen.getByRole("button", { name: "Viewing" }));
    expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool", "pan");
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(props.toolControls?.modeRequest?.mode).toBe("idle");
    expect(props.selectedId).toBeNull();
    expect(screen.getByRole("button", { name: "Measure" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Pan drawing" })).toBeNull();
    openMenu("More");
    expect(screen.getByRole("heading", { name: "Tools" })).toBeVisible();
  });
  it("floats a Done button while anything is in use that goes back to Viewing or Select, whichever was last", () => {
    open();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    chooseTool("select");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    chooseTool("rect");
    const controls = screen.getByRole("button", { name: "Tool Controls" });
    expect(controls).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("toolbar", { name: "Markup controls" })).toBeVisible();
    fireEvent.click(controls);
    expect(screen.queryByRole("toolbar", { name: "Markup controls" })).toBeNull();
    fireEvent.click(controls);
    expect(screen.getByRole("toolbar", { name: "Markup controls" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute("data-drawing-tool-done");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool", "select");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();

    openMenu("More");
    fireEvent.click(screen.getByRole("button", { name: "Edit Mode" }));
    openMenu("Tools");
    fireEvent.click(screen.getByRole("button", { name: "Viewing" }));
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    act(() => props.toolControls?.onMode?.({ measuring: true, pipe: false }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const next = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(next.toolControls?.modeRequest?.mode).toBe("idle");
    expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool", "pan");
  });
  it("offers Viewing in the quick wheel and clears the selected markup", () => {
    mocks.data!.entities = [existingMarkup()];
    open(true);
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    act(() => props.onSelect?.(entityId));
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "Drawing tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.queryByRole("button", { name: "Pan drawing" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Viewing" }));
    const next = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(next.tool).toBe("pan");
    expect(next.selectedId).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("makes Viewing available to users who cannot annotate", () => {
    mocks.data!.canAnnotate = false;
    open(); openMenu("Tools");
    const viewing = screen.getByRole("button", { name: "Viewing" });
    expect(viewing).toBeEnabled();
    fireEvent.click(viewing);
    expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool", "pan");
  });
  it("finishes a text note when entering Viewing without reselecting the saved note", async () => {
    open(); chooseTool("text");
    fireEvent.click(screen.getByRole("button", { name: "Draw sample" }));
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Keep this note" } });
    openMenu("Tools");
    fireEvent.click(screen.getByRole("button", { name: "Viewing" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({ data: { type: "text", text: "Keep this note" } });
    expect(screen.queryByLabelText("Text")).toBeNull();
    const next = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(next.tool).toBe("pan");
    expect(next.selectedId).toBeNull();
  });
  it("retains wheel navigation and an exit when offline annotation data is unavailable", () => {
    const exit = vi.fn();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mocks.data = null;
    const next = vi.fn();
    render(<DrawingWorkspace fullscreen onFullscreen={exit} jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} pageNavigation={{ index: 0, count: 2, onPrevious: vi.fn(), onNext: next }} />);
    fireEvent.keyDown(screen.getByTestId("markup-editor"), { key: "ContextMenu" });
    expect(screen.queryByRole("button", { name: "Page" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next page" })); expect(next).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByTestId("markup-editor"), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(exit).toHaveBeenCalledOnce();
  });

  it("shows the drawing while its tools are still loading", () => {
    mocks.data = null;
    render(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />);
    expect(screen.getByTestId("markup-editor")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Loading drawing tools…");
    expect(mocks.viewer.mock.lastCall?.[0]).toMatchObject({ src: sheet.imageUrl });
  });

  it("waits for the local file lookup before giving the viewer any network PDF, even while online", async () => {
    const imageUrl = `/api/job-rooms/files/${jobId}/${sheetId}/floor-1.webp`;
    const localSheet = { ...sheet, imageUrl };
    const saved = fixture();
    saved.jobSheets = saved.jobSheets.map(item => ({ ...item, imageUrl }));
    mocks.data = null; // Background update has not answered.
    let finish!: (url: string) => void;
    const resolve = vi.fn((url: string) => url.endsWith(".pdf")
      ? new Promise<string>(done => { finish = done; }) : Promise.resolve("blob:preview"));
    mocks.account = { userId: "tim", accountKey: "org:tim", store: {
      readSnapshot: vi.fn(async (key: string) => key.startsWith("workspace:") ? saved : null), saveSnapshot: vi.fn(async () => undefined), resolveAssetUrl: resolve,
    } as unknown as DrawingOfflineStore };
    render(<DrawingWorkspace jobId={jobId} sheet={localSheet} onOpenSheet={vi.fn()} />);
    expect(mocks.viewer).not.toHaveBeenCalled();
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    await act(async () => { finish("blob:saved-pdf"); });
    await screen.findByTestId("markup-editor");
    expect(mocks.viewer.mock.lastCall?.[0]).toMatchObject({ src: "blob:preview", pdf: { url: "blob:saved-pdf" }, placeholderSrc: null, tiles: null });
    expect(screen.queryByText("Loading drawing tools…")).toBeNull();
  });

  it("does not show the drawing when access is revoked, even offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mocks.data = null;
    mocks.queryError = { message: "Drawing access denied", data: { code: "FORBIDDEN" } };
    open();
    expect(screen.queryByTestId("markup-editor")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Drawing access denied");
  });

  it("keeps one viewer and shared toolbar mounted as tools finish loading", () => {
    mocks.data = null;
    const props = { jobId, sheet, onOpenSheet: vi.fn() };
    const { rerender } = render(<DrawingWorkspace {...props} />);
    const viewer = screen.getByTestId("markup-editor");
    const toolbar = screen.getByRole("toolbar", { name: "Drawing tools" });
    const loading = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(loading.toolControls).toBeDefined();
    expect(loading.onSavePipeComponent).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Markup" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pipe system" })).toBeNull();
    mocks.data = fixture();
    rerender(<DrawingWorkspace {...props} />);
    expect(screen.getByTestId("markup-editor")).toBe(viewer);
    expect(screen.getByRole("toolbar", { name: "Drawing tools" })).toBe(toolbar);
    expect(screen.getByRole("button", { name: "Markup" })).toBeVisible();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("uses quick wheel only in fullscreen and restores regular controls on exit", () => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "foremanhq:drawing-quick-wheel:guest" ? "on" : null });
    const props = { jobId, sheet, onOpenSheet: vi.fn() };
    const view = render(<DrawingWorkspace {...props} />);
    openMenu("More");
    expect(screen.queryByRole("switch", { name: "Quickwheel mode" })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Drawing tools" })).toBeVisible();
    view.rerender(<DrawingWorkspace {...props} fullscreen />);
    expect(screen.queryByRole("toolbar", { name: "Drawing tools" })).toBeNull();
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "F10", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(mocks.viewer.mock.lastCall?.[0].toolControls.modeRequest.mode).toBe("measure");
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "F10", shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(mocks.viewer.mock.lastCall?.[0].toolControls.modeRequest.mode).toBe("idle");
    view.rerender(<DrawingWorkspace {...props} />);
    expect(screen.getByRole("toolbar", { name: "Drawing tools" })).toBeVisible();
  });

  it.each([["Markup", "Rectangle"], ["Tools", "Pipe system"]])("suspends the wheel during %s / %s until Done", (group, action) => {
    open(true);
    const workspace = screen.getByLabelText("Drawing workspace");
    fireEvent.keyDown(workspace, { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: group }));
    fireEvent.click(screen.getByRole("button", { name: action }));
    fireEvent.keyDown(workspace, { key: "ContextMenu" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(mocks.viewer.mock.lastCall?.[0].toolControls.modeRequest.mode).toBe("idle");
    expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool", "pan");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    fireEvent.keyDown(workspace, { key: "ContextMenu" });
    expect(screen.getByRole("button", { name: "Measure" })).toBeVisible();
  });

  it("toggles quick-wheel markup styling and hides it again on Done", () => {
    open(true);
    const workspace = screen.getByLabelText("Drawing workspace");
    fireEvent.keyDown(workspace, { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "Markup" }));
    fireEvent.click(screen.getByRole("button", { name: "Pen" }));
    expect(screen.queryByRole("toolbar", { name: "Markup controls" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tool Controls" }));
    const bar = screen.getByRole("toolbar", { name: "Markup controls" });
    fireEvent.click(within(bar).getByRole("radio", { name: "Width 0.1" }));
    expect(mocks.viewer.mock.lastCall?.[0].style.width).toBe(0.1);
    fireEvent.click(within(bar).getByRole("button", { name: "Blue" }));
    expect(mocks.viewer.mock.lastCall?.[0].style.stroke).toBe("#2563eb");
    fireEvent.click(screen.getByRole("button", { name: "Tool Controls" }));
    expect(screen.queryByRole("toolbar", { name: "Markup controls" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tool Controls" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("toolbar", { name: "Markup controls" })).toBeNull();
    fireEvent.keyDown(workspace, { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.queryByRole("toolbar", { name: "Markup controls" })).toBeNull();
    expect(mocks.viewer.mock.lastCall?.[0].toolControls.toolbarHidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Tool Controls" }));
    expect(mocks.viewer.mock.lastCall?.[0].toolControls.toolbarHidden).toBe(false);
  });

  it("exposes page navigation and selected markup actions through the wheel", async () => {
    mocks.data!.entities = [existingMarkup()];
    const onNext = vi.fn();
    render(<DrawingWorkspace fullscreen jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()}
      pageNavigation={{ index: 0, count: 2, onPrevious: vi.fn(), onNext }} />);
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "ContextMenu" });
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" })); expect(onNext).toHaveBeenCalledOnce();
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    act(() => props.onSelect?.(entityId));
    expect(screen.getByRole("toolbar", { name: "Selected markup actions" })).toHaveClass("bg-background/60", "backdrop-blur-sm", "rounded-2xl");
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "ContextMenu" });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Move" }).length).toBeGreaterThan(0));
    expect(screen.getAllByRole("button", { name: "Resize" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("prompts to calibrate before Super scale, then continues only after a saved calibration", () => {
    open();
    const start = () => {
      openMenu("More");
      fireEvent.click(screen.getByRole("button", { name: "Super scale" }));
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

  it("hides every Sheet tool when permission is denied, while keeping drawing controls", () => {
    mocks.data!.canUseSheetTools = false;
    open();
    openMenu("More");
    for (const name of ["Auto Hyperlink", "Legend Items", "Super Spec Material", "Super Label", "Super scale"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "Fit to screen" })).toBeEnabled();
  });

  it("keeps restricted sheet commands disabled in the wheel rather than changing its layout", () => {
    mocks.data!.canUseSheetTools = false;
    open(true);
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("button", { name: "Drawing appearance" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "AI Tools" }));
    for (const name of ["Auto Hyperlink", "Legend Items", "Super Equipment", "Super Spec Material", "Super Label", "Super scale"])
      expect(screen.getByRole("button", { name })).toBeDisabled();
  });

  it("offers Super scale under More", () => {
    open();
    openMenu("More");
    const ai = screen.getByRole("region", {name: "AI Tools"});
    expect(within(ai).getByRole("heading", {name: "AI Tools"})).toBeInTheDocument();
    for (const name of ["Auto Hyperlink", "Legend Items", "Super Equipment", "Super Label", "Super scale"])
      expect(within(ai).getByRole("button", {name})).toBeInTheDocument();
    expect(within(ai).queryByRole("button", {name: "Fit to screen"})).not.toBeInTheDocument();
    expect(within(ai).queryByRole("button", {name: "Super Spec Material"})).not.toBeInTheDocument();
    for (const name of ["Super scale results", "Snapshot", "Download / offline", "Available offline"]) {
      expect(screen.queryByRole("menuitem", {name})).toBeNull();
      expect(screen.queryByRole("button", {name})).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", {name:"Super scale"}));
    expect(screen.getByText("Super scale grid matching")).toBeInTheDocument();
  });

  it("offers text editing through the wheel without opening a competing text editor or context menu", () => {
    const note = existingMarkup();
    if (note.kind === "markup") note.data = { ...note.data, type: "text", text: "Test note", points: [{ x: 0.2, y: 0.2 }] };
    mocks.data!.entities = [note];
    open(true);
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
      "/jobs",
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
      "/jobs",
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
    if (!mocks.viewer.mock.lastCall?.[0].onPdfLink) enableHyperlinks();
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
    if (!mocks.viewer.mock.lastCall?.[0].onPdfLink) enableHyperlinks();
    fireEvent.click(screen.getByRole("button", { name: "Tap hyperlink" }));
    fireEvent.click(screen.getByRole("button", { name: "Revision drawing" }));
    const target = mocks.data!.jobSheets.find(s=>s.id===revisionId)!;
    expect(mocks.push).toHaveBeenLastCalledWith(`/jobs/${jobId}/drawings?drawingSet=${target.setId}&drawingSheet=${revisionId}`,{scroll:false});
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
    if (!mocks.viewer.mock.lastCall?.[0].onPdfLink) enableHyperlinks();
    fireEvent.click(screen.getByRole("button", { name: "Tap hyperlink" }));
    expect(open).toHaveBeenLastCalledWith(
      "https://example.com/legacy",
      "_blank",
      "noopener,noreferrer",
    );
    entity.data = {
      ...entity.data,
      links: [{ label: "Chat", url: `/jobs/${jobId}/chat` }],
    };
    view.rerender(
      <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />,
    );
    if (!mocks.viewer.mock.lastCall?.[0].onPdfLink) enableHyperlinks();
    fireEvent.click(screen.getByRole("button", { name: "Tap hyperlink" }));
    expect(mocks.push).toHaveBeenLastCalledWith(`/jobs/${jobId}/chat`, { scroll: false });
    expect(open).toHaveBeenCalledTimes(1);
    const destinationEvent = vi.fn();
    window.addEventListener(DRAWING_DESTINATION_EVENT,destinationEvent);
    entity.data.links = [{ label: "Drawing", url: `${location.origin}/jobs/${jobId}/drawings?drawingSheet=${sheetId}#detail` }];
    view.rerender(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />);
    if (!mocks.viewer.mock.lastCall?.[0].onPdfLink) enableHyperlinks();
    fireEvent.click(screen.getByRole("button", { name: "Tap hyperlink" }));
    expect(mocks.push).toHaveBeenLastCalledWith(`/jobs/${jobId}/drawings?drawingSheet=${sheetId}#detail`, { scroll: false });
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
      target: { value: `/jobs/${jobId}/chat` },
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
        opacity: 0.55,
        stroke: "#00c9ad",
        fill: "#00c9ad",
        text: "AHU-1",
        links: [
          { label: "Equipment manual", url: "https://example.com/manual" },
          { label: "Job discussion", url: `/jobs/${jobId}/chat` },
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
  it("follows original uploaded page links without creating editable markups", async () => {
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
    enableHyperlinks();
    fireEvent.click(
      screen.getByRole("button", { name: "Follow original page link" }),
    );
    const target = mocks.data!.jobSheets[1]!;
    await waitFor(() => expect(mocks.push).toHaveBeenLastCalledWith(`/jobs/${jobId}/drawings?drawingSet=${target.setId}&drawingSheet=${target.id}`,{scroll:false}));
    expect(onOpenSheet).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("opens original web links using their retained protocol", () => {
    const browser = vi.spyOn(window, "open").mockReturnValue(null);
    open();
    enableHyperlinks();
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
  it("explains when an original linked page is absent from this job", async () => {
    mocks.data!.jobSheets[0]!.imageUrl = `/api/job-rooms/files/${jobId}/${sheetId}/floor-1.webp`;
    open();
    enableHyperlinks();
    fireEvent.click(
      screen.getByRole("button", { name: "Follow original page link" }),
    );
    expect(
      await screen.findByText("That linked page has not been added to this job."),
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
    fireEvent.click(screen.getByRole("button", { name: "Overlay drawings" }));
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

  it("compares files side by side from Overlay drawings in the drawing area", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ documents: [], versions: [] }))));
    open();
    openMenu("More");
    expect(screen.queryByRole("button", { name: "Compare files" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Overlay drawings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Compare files" }));
    fireEvent.click(screen.getByRole("button", { name: "Compare side by side" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await screen.findByRole("region", {name: "Left comparison"});
    const region = screen.getByRole("region", { name: "Compare files" });
    expect(within(region).getByRole("region", { name: "Left comparison" })).toBeVisible();
    expect(within(region).getByRole("region", { name: "Right comparison" })).toBeVisible();
    await screen.findByText("Choose a file to compare.");
    fireEvent.click(within(region).getByRole("button", { name: "Overlay" }));
    document.querySelectorAll("details").forEach((group) => (group.open = true));
    fireEvent.click(screen.getByLabelText("A101 revision 2"));
    fireEvent.click(screen.getByRole("button", { name: "Open overlay" }));
    expect(screen.getByTestId("comparison")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Compare files" })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("keeps the active tool name and finishes it from the same button", () => {
    open();
    const toolbar=screen.getByRole("toolbar",{name:"Drawing tools"});
    for(const id of ["select","line","rect","link"]) {
      chooseTool(id);
      if (["select", "link"].includes(id)) openMenu("More");
      const label=tools.find(([tool])=>tool===id)![1];
      const button=within(toolbar).getByRole("button",{name:label,pressed:true});
      expect(button).toHaveTextContent(label);
      expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool",id);
      expect(within(toolbar).queryByRole("button",{name:"Done"})).toBeNull();
      fireEvent.click(button);
      expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool","pan");
    }
  });
  it("keeps Markup as a chooser while Tools is an inline section",()=>{
    open(); const toolbar=screen.getByRole("toolbar",{name:"Drawing tools"});
    openMenu("More");
    expect(within(toolbar).getByRole("heading",{name:"Tools"})).toBeVisible();
    expect(within(toolbar).queryByRole("button",{name:"Tools"})).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(within(toolbar).getByRole("button",{name:"Markup"}));
    const button=within(toolbar).getByRole("button",{name:"Markup"});
    expect(button).toHaveClass("bg-primary");expect(button).toHaveAttribute("aria-expanded","true");
    fireEvent.click(button);
    expect(screen.queryByRole("dialog",{name:"Markup tools"})).toBeNull();
    expect(button).not.toHaveClass("bg-primary");
  });

  it("shows individual actions directly in More and toggles panels from their own buttons", () => {
    open(); panel("details");
    expect(screen.getByRole("heading", { name: "Sheet details" })).toBeVisible();
    openMenu("More");
    expect(screen.queryByRole("button", { name: /options/i })).toBeNull();
    const toolbar = screen.getByRole("toolbar", { name: "Drawing tools" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Sheet details", pressed: true }));
    expect(screen.queryByRole("heading", { name: "Sheet details" })).toBeNull();
  });
  it("retains active names when switching between markup, measure and pipe",()=>{
    open();chooseTool("line");const toolbar=screen.getByRole("toolbar",{name:"Drawing tools"});
    fireEvent.click(within(toolbar).getByRole("button",{name:"Measure"}));
    expect(within(toolbar).getByRole("button",{name:"Measure",pressed:true})).toBeVisible();
    expect(screen.getByTestId("markup-editor")).toHaveAttribute("data-tool","pan");
    openMenu("Tools");fireEvent.click(screen.getByRole("button",{name:"Pipe system"}));
    openMenu("More");
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
    fireEvent.click(screen.getByRole("button", { name: "Overlay drawings" }));
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

  it.each([false, true])("keeps markup move, resize, and delete available (fullscreen=%s)", async (fullscreen) => {
    mocks.data!.entities = [existingMarkup()];
    open(fullscreen);
    fireEvent.click(
      screen.getByRole("button", { name: "Select first annotation" }),
    );
    expect(
      screen.getByRole("toolbar", { name: "Selected markup actions" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Drawing tools panel")).toBeNull();
    // The complete menu is available immediately; only dragging waits for pickup.
    expect(screen.queryByText("Read only")).toBeNull();
    expect(screen.getByRole("button", { name: "Resize" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Markup style" })).toBeVisible();
    const viewer = () => mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(viewer().canEditAnnotation?.(entityId)).toBe(false);
    const menu = screen.getByRole("toolbar", { name: "Selected markup actions" });
    const controls = menu.querySelectorAll("button").length;
    await waitFor(() => expect(viewer().canEditAnnotation?.(entityId)).toBe(true));
    expect(menu.querySelectorAll("button")).toHaveLength(controls);
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
      expect(screen.getByRole("status")).toBeEmptyDOMElement(),
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
    openMenu("More");
    fireEvent.click(
      within(screen.getByRole("toolbar", { name: "Drawing tools" })).getByRole(
        "button",
        { name: "Edit Mode" },
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
      expect(screen.getByRole("status")).toBeEmptyDOMElement(),
    );
  });
  it("uses the personal Private default for new shapes, text and hyperlink drafts", async () => {
    mocks.data!.canManage = false;
    mocks.account = {
      userId: mocks.data!.actor.id,
      accountKey: "private-pref-0",
      store: null,
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "foremanhq:drawing-markup-visibility:private-pref-0"
          ? "private"
          : null,
    });
    open();
    openMenu("More");
    expect(
      screen.queryByRole("button", { name: "Default markup visibility" }),
    ).not.toBeInTheDocument();
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
    mocks.account = {
      userId: mocks.data!.actor.id,
      accountKey: "private-pref-1",
      store: null,
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "foremanhq:drawing-markup-visibility:private-pref-1"
          ? "private"
          : null,
    });
    open();
    openMenu("More");
    expect(
      screen.queryByRole("button", { name: "Default markup visibility" }),
    ).not.toBeInTheDocument();
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
  it("shows removal intent immediately and keeps a refused drawing item available", async () => {
    const entity = existingMarkup("published");
    mocks.data!.entities = [entity];
    let reject!: (reason: Error) => void;
    mocks.archive.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Select first annotation" }));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const panel = screen.getByLabelText("Drawing tools panel");
    fireEvent.click(within(panel).getByRole("button", { name: "Delete" }));
    expect(within(panel).getByRole("button", { name: "Removing…" })).toBeDisabled();
    expect(screen.getByText(`Removing ${(entity.data as { type: string }).type}…`)).toBeVisible();
    expect(mocks.data!.entities[0]!.visibility).toBe("published");
    await act(async () => { reject(new Error("This item changed. Refresh and try again.")); });
    expect(screen.queryByText(`Removing ${(entity.data as { type: string }).type}…`)).toBeNull();
    expect(screen.getByText("This item changed. Refresh and try again.")).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(mocks.data!.entities[0]!.visibility).toBe("published");
  });
  it("sends one removal for duplicate viewer callbacks before controls rerender", async () => {
    const entity = existingMarkup("published");
    mocks.data!.entities = [entity];
    let resolve!: (value: DrawingEntity) => void;
    mocks.archive.mockImplementationOnce(() => new Promise<DrawingEntity>(done => { resolve = done; }));
    open();
    const viewer = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    let first!: Promise<boolean>, duplicate!: Promise<boolean>;
    act(() => {
      first = viewer.onRemoveMeasurement!(entity.id);
      duplicate = viewer.onRemoveMeasurement!(entity.id);
    });
    expect(mocks.archive).toHaveBeenCalledOnce();
    expect(await duplicate).toBe(false);
    expect(mocks.data!.entities[0]!.visibility).toBe("published");
    await act(async () => {
      resolve({ ...entity, visibility: "archived", revision: entity.revision + 1 });
      expect(await first).toBe(true);
    });
    expect(mocks.data!.entities[0]!.visibility).toBe("archived");
    expect(screen.queryByText(`Removing ${(entity.data as { type: string }).type}…`)).toBeNull();
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
    expect(within(menu).getAllByRole("menuitem").map(item=>item.textContent)).toEqual(["Lock","Move","Resize","Edit","Details","Delete"]);
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
  it("shows only the selected shape's style after drawing, then restores drawing controls on deselect", async () => {
    open();
    chooseTool("ellipse");
    expect(screen.getByRole("toolbar", { name: "Markup controls" })).toBeVisible();
    const markup = existingMarkup();
    if (markup.kind !== "markup") throw Error("Expected a markup");
    const viewer = () => mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    act(() => {
      viewer().onCreate?.({ ...markup.data, type: "ellipse" });
    });
    const selectedActions = await screen.findByRole("toolbar", { name: "Selected markup actions" });
    await waitFor(() => expect(screen.getByRole("status")).toBeEmptyDOMElement());
    expect(screen.queryByRole("toolbar", { name: "Markup controls" })).toBeNull();
    await within(selectedActions).findByRole("group", { name: "Markup style" });
    expect(screen.getAllByRole("group", { name: "Markup style" })).toHaveLength(1);
    fireEvent.click(within(selectedActions).getByRole("button", { name: "Blue" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.lastCall?.[0]).toMatchObject({
      id: mocks.save.mock.calls[0]![0].id,
      data: { type: "ellipse", stroke: "#2563eb" },
    });
    await waitFor(() => expect(screen.getByRole("status")).toBeEmptyDOMElement());
    act(() => viewer().onSelect?.(null));
    expect(screen.queryByRole("toolbar", { name: "Selected markup actions" })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Markup controls" })).toBeVisible();
    expect(screen.getAllByRole("group", { name: "Markup style" })).toHaveLength(1);
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
    expect(screen.getByRole("button", { name: "Move" })).toBeEnabled();
    await waitFor(() => expect(mocks.viewer.mock.lastCall?.[0].canEditAnnotation?.(entityId)).toBe(true));
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
    fireEvent.click(screen.getByRole("button", { name: "Super scale" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Super scale" }));
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

it("pins full screen, layers and the layers panel to the viewer while pages scroll", () => {
  const corners = document.createElement("div");
  document.body.append(corners);
  const view = render(
    <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} scrollPages
      cornerContainer={corners} onFullscreen={vi.fn()} />,
  );
  expect(within(view.container).queryByRole("button", { name: "Layers" })).toBeNull();
  expect(within(view.container).queryByRole("button", { name: "Full screen" })).toBeNull();
  expect(within(corners).getByRole("button", { name: "Full screen" })).toBeVisible();
  fireEvent.click(within(corners).getByRole("button", { name: "Layers" }));
  expect(within(corners).getByRole("complementary", { name: "Drawing tools panel" })).toBeVisible();
  view.unmount();
  expect(corners).toBeEmptyDOMElement();
  corners.remove();
});

it("remembers the captured source drawing view before following an internal hyperlink",()=>{
 const entity=existingMarkup();
 if(entity.kind!=="markup")throw Error("fixture");
 entity.data={...entity.data,type:"link",links:[{label:"Documents",url:`/jobs/${jobId}/documents`}]};
 mocks.data!.entities=[entity];
 const href=`/jobs/${jobId}/drawings?drawingSheet=${sheetId}#snapshot=captured-zoom`;
 const captureSource=vi.fn(()=>({href,title:"Source",capturedAt:new Date().toISOString()}));
 const visit=vi.fn();window.addEventListener(HYPERLINK_VISIT_EVENT,visit);
 render(<SnapshotSourceContext.Provider value={{captureSource,register:()=>()=>{},registerPage:()=>()=>{}}}>
   <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()}/>
 </SnapshotSourceContext.Provider>);
 enableHyperlinks();
 fireEvent.click(screen.getByRole("button",{name:"Tap hyperlink"}));
 expect(captureSource).toHaveBeenCalledOnce();
 expect(visit).toHaveBeenCalledWith(expect.objectContaining({detail:{source:href,target:new URL(`/jobs/${jobId}/documents`,location.origin).href}}));
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

it("searches the job's drawings and documents from the split button by the arrow", async () => {
  mocks.linkTargets = ({ kind, query }) =>
    query === "spec" && kind === "document"
      ? [{ key: "doc", label: "Mechanical spec", url: `/jobs/${jobId}/documents?document=doc` }]
      : [];
  try {
    render(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />);
    const bar = screen.getByRole("toolbar", { name: "Drawing tools" });
    fireEvent.click(within(bar).getByRole("button", { name: "Search drawings and documents" }));
    fireEvent.change(within(bar).getByRole("searchbox", { name: "Search drawings and documents" }), { target: { value: "spec" } });
    const found = await screen.findByRole("region", { name: "Drawings and documents found" });
    fireEvent.click(within(found).getByRole("button", { name: /Mechanical spec/ }));
    expect(mocks.push).toHaveBeenLastCalledWith(`/jobs/${jobId}/documents?document=doc`, { scroll: false });
    expect(screen.queryByRole("region", { name: "Drawings and documents found" })).toBeNull();
  } finally {
    mocks.linkTargets = () => [];
  }
});

it("searches the text in the drawing PDFs and goes to it on the page", async () => {
  const box = { left: 0.4, top: 0.5, right: 0.45, bottom: 0.52 };
  mocks.textSearch = ({ kind, query }) =>
    query === "pipe" && kind === "drawing"
      ? [{ kind: "drawing", id: sheet.id, name: sheet.name, page: 1, text: "PIPE SLEEVE", url: "/elsewhere", sourceSheetId: sheet.id, box: { ...box, text: "PIPE SLEEVE" } }]
      : query === "pipe"
        ? [{ kind: "document", id: "doc", name: "Plumbing spec", page: 4, text: "Pipe hangers", url: `/jobs/${jobId}/documents?document=doc` }]
        : [];
  try {
    render(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />);
    const bar = screen.getByRole("toolbar", { name: "Drawing tools" });
    fireEvent.click(within(bar).getByRole("button", { name: "Search drawings and documents" }));
    fireEvent.change(within(bar).getByRole("searchbox", { name: "Search drawings and documents" }), { target: { value: "pipe" } });
    const found = await screen.findByRole("region", { name: "Drawings and documents found" });
    expect(await within(found).findByRole("button", { name: /Pipe hangers.*Plumbing spec · page 4/ })).toBeVisible();
    fireEvent.click(within(found).getByRole("button", { name: /PIPE SLEEVE/ }));
    expect(mocks.push).not.toHaveBeenCalledWith("/elsewhere", expect.anything());
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(props.navigateTo?.center.x).toBeCloseTo(0.425);
    expect(props.navigateTo?.center.y).toBeCloseTo(0.51);
    expect(props.annotations?.some((entity) => entity.id === "search-highlight")).toBe(true);
    expect(screen.queryByRole("region", { name: "Drawings and documents found" })).toBeNull();
  } finally {
    mocks.textSearch = () => [];
  }
});

it("moves through the search results with the arrows by the X", async () => {
  const hit = (text: string, x: number) => ({ kind: "drawing", id: sheet.id, name: sheet.name, page: 1, text, url: "/elsewhere", sourceSheetId: sheet.id, box: { left: x, top: 0.5, right: x + 0.1, bottom: 0.52, text } });
  mocks.textSearch = ({ kind, query }) => (query === "pipe" && kind === "drawing" ? [hit("PIPE A", 0.1), hit("PIPE B", 0.6)] : []);
  try {
    render(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />);
    const bar = screen.getByRole("toolbar", { name: "Drawing tools" });
    fireEvent.click(within(bar).getByRole("button", { name: "Search drawings and documents" }));
    fireEvent.change(within(bar).getByRole("searchbox", { name: "Search drawings and documents" }), { target: { value: "pipe" } });
    const found = await screen.findByRole("region", { name: "Drawings and documents found" });
    const current = () => within(found).getAllByRole("button").find((button) => button.getAttribute("aria-current") === "true")?.textContent;
    expect(current()).toMatch(/PIPE A/);
    fireEvent.click(within(bar).getByRole("button", { name: "Next result" }));
    expect(current()).toMatch(/PIPE B/);
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(props.navigateTo?.center.x).toBeCloseTo(0.65);
    // Stepping keeps the search open; it wraps around.
    fireEvent.click(within(bar).getByRole("button", { name: "Next result" }));
    expect(current()).toMatch(/PIPE A/);
    fireEvent.click(within(bar).getByRole("button", { name: "Previous result" }));
    expect(current()).toMatch(/PIPE B/);
    expect(mocks.push).not.toHaveBeenCalledWith("/elsewhere", expect.anything());
  } finally {
    mocks.textSearch = () => [];
  }
});

it("keeps full screen on the drawing and Tools in the three-slot bar overflow", () => {
  const onFullscreen = vi.fn();
  render(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} onFullscreen={onFullscreen} />);
  const bar = screen.getByRole("toolbar", { name: "Drawing tools" });
  expect(within(bar).getAllByRole("button").map(button => button.getAttribute("aria-label") ?? button.textContent)).toEqual(["Expand all actions", "Search drawings and documents", "Markup", "Measure"]);
  expect(bar.querySelector("[data-action-bar-row]")!.children).toHaveLength(3);
  expect(within(bar).queryByRole("button", {name:"Tools"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
  expect(onFullscreen).toHaveBeenCalled();
  openMenu("More");
  expect(within(screen.getByRole("group", {name:"More actions"})).getByRole("heading",{name:"Tools"})).toBeVisible();
  const headings = within(bar).getAllByRole("heading").map(heading=>heading.textContent);
  expect(headings.indexOf("Tools")).toBeGreaterThan(headings.indexOf("AI Tools"));
  expect(within(screen.getByRole("region",{name:"Tools"})).getByRole("button",{name:"Viewing"})).toBeVisible();
  expect(screen.queryByRole("switch", { name: "Quickwheel mode" })).toBeNull();
});

it("opens layers directly from the drawing corner, including full screen", () => {
  const base = existingMarkup("published");
  mocks.data!.entities = (["arrow", "dimension"] as const).map((type) => ({
    ...base,
    id: crypto.randomUUID(),
    data: { ...base.data, type },
  })) as DrawingEntity[];
  open();
  const layers = screen.getByRole("button", { name: "Layers" });
  expect(layers).toHaveClass("rounded-full", "size-10");
  fireEvent.click(layers);
  expect(layers).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("complementary", { name: "Drawing tools panel" })).not.toHaveAttribute("data-drawing-chrome");
  expect(screen.getByRole("button", { name: "Arrow layer" })).not.toBeVisible();
  const markup = screen.getByText("Markup", { selector: "summary span" }).closest("details")!;
  expect(markup).not.toHaveAttribute("open");
  const markups = screen.getByRole("button", { name: "Markup layer" });
  fireEvent.click(markups);
  expect(markups).toHaveAttribute("aria-pressed", "false");
  expect(markup).not.toHaveAttribute("open");
  fireEvent.click(markup.querySelector("summary")!);
  const arrow = screen.getByRole("button", { name: "Arrow layer" });
  fireEvent.click(arrow);
  expect(arrow).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Measure layer" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("On this sheet")).toBeNull();
  // Only what is on the sheet: no rectangles, and no pins at all.
  expect(screen.queryByRole("button", { name: "Rectangle layer" })).toBeNull();
  // Original PDF links are unknown until enabled, so their switch stays available.
  expect(screen.getByRole("button", {name:"Hyperlink layer"})).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(layers);
  expect(screen.queryByRole("complementary", { name: "Drawing tools panel" })).not.toBeInTheDocument();
});

it("says when a sheet has nothing to show or hide", () => {
  mocks.data!.entities = [];
  open();
  fireEvent.click(screen.getByRole("button", { name: "Layers" }));
  expect(screen.getByText("Nothing has been added to this sheet yet.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Measure layer" })).toBeNull();
  expect(screen.queryByText("Markup", { selector: "summary span" })).toBeNull();
});

it("keeps individual annotations out of Layers and remembers hidden drawing content after reopening", () => {
  mocks.account = { userId: "tim", accountKey: `layers-${crypto.randomUUID()}`, store: null };
  mocks.data!.entities = [existingMarkup()];
  const first = open();
  fireEvent.click(screen.getByRole("button", { name: "Layers" }));
  const sidebar = screen.getByRole("complementary", { name: "Drawing tools panel" });
  expect(within(sidebar).queryByRole("button", { name: "rect private" })).toBeNull();
  const details = within(sidebar).getByText("Markup", { selector: "summary span" }).closest("details")!;
  fireEvent.click(details.querySelector("summary")!);
  fireEvent.click(within(sidebar).getByRole("button", { name: "Rectangle layer" }));
  expect(mocks.viewer.mock.lastCall?.[0].annotations).toHaveLength(0);
  first.unmount();
  open();
  expect(mocks.viewer.mock.lastCall?.[0].annotations).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Layers" }));
  const reopened = screen.getByText("Markup", { selector: "summary span" }).closest("details")!;
  expect(reopened).not.toHaveAttribute("open");
  fireEvent.click(reopened.querySelector("summary")!);
  expect(screen.getByRole("button", { name: "Rectangle layer" })).toHaveAttribute("aria-pressed", "false");
});

it("switches off one person's markups from Layers and remembers it", () => {
  mocks.account = { userId: "tim", accountKey: `people-${crypto.randomUUID()}`, store: null };
  const mine = existingMarkup();
  mocks.data!.entities = [
    mine,
    { ...mine, id: crypto.randomUUID(), authorId: "chris", authorName: "Chris" },
    { ...mine, id: crypto.randomUUID(), authorId: "chris", authorName: "Chris" },
  ];
  const first = open();
  expect(mocks.viewer.mock.lastCall?.[0].annotations).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Layers" }));
  const people = screen.getByText("People", { selector: "summary span" }).closest("details")!;
  fireEvent.click(people.querySelector("summary")!);
  expect(within(people).getAllByRole("button").map((row) => row.textContent)).toEqual(["Tim (you)1", "Chris2"]);
  const chris = screen.getByRole("button", { name: "Chris layer" });
  fireEvent.click(chris);
  expect(chris).toHaveAttribute("aria-pressed", "false");
  expect(mocks.viewer.mock.lastCall?.[0].annotations.map((entity: { authorId: string }) => entity.authorId)).toEqual(["tim"]);
  first.unmount();
  open();
  expect(mocks.viewer.mock.lastCall?.[0].annotations).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Layers" }));
  fireEvent.click(screen.getByRole("button", { name: "Chris layer" }));
  expect(mocks.viewer.mock.lastCall?.[0].annotations).toHaveLength(3);
});

it("shows only my markups from People, including anyone who draws later", () => {
  mocks.account = { userId: "tim", accountKey: `mine-${crypto.randomUUID()}`, store: null };
  const mine = existingMarkup();
  mocks.data!.entities = [mine, { ...mine, id: crypto.randomUUID(), authorId: "chris", authorName: "Chris" }];
  const first = open();
  fireEvent.click(screen.getByRole("button", { name: "Layers" }));
  const people = screen.getByText("People", { selector: "summary span" }).closest("details")!;
  fireEvent.click(people.querySelector("summary")!);
  const onlyMine = screen.getByRole("switch", { name: "Show only mine" });
  expect(onlyMine).toHaveAttribute("aria-checked", "false");
  fireEvent.click(onlyMine);
  expect(onlyMine).toHaveAttribute("aria-checked", "true");
  expect(mocks.viewer.mock.lastCall?.[0].annotations.map((entity: { authorId: string }) => entity.authorId)).toEqual(["tim"]);
  expect(within(people).getByText("Only mine")).toBeInTheDocument();
  first.unmount();
  mocks.data!.entities = [...mocks.data!.entities, { ...mine, id: crypto.randomUUID(), authorId: "sam", authorName: "Sam" }];
  open();
  expect(mocks.viewer.mock.lastCall?.[0].annotations.map((entity: { authorId: string }) => entity.authorId)).toEqual(["tim"]);
  fireEvent.click(screen.getByRole("button", { name: "Layers" }));
  fireEvent.click(screen.getByRole("switch", { name: "Show only mine" }));
  expect(mocks.viewer.mock.lastCall?.[0].annotations).toHaveLength(3);
});

it("loads deferred destinations only when a link is opened, with recoverable errors", async () => {
  const entity = existingMarkup();
  if (entity.kind !== "markup") throw Error("fixture");
  const full = { ...entity, data: { ...entity.data, type: "link" as const, links: [{label:"Saved destination", url:"/jobs"}] } };
  const deferred = { ...full, data: { ...full.data, links: undefined, deferredLinks: {id:entity.id, revision:entity.revision, count:1} } };
  mocks.data!.entities = [deferred];
  mocks.loadLink.mockRejectedValueOnce(Error("Network interrupted"));
  mocks.loadLink.mockResolvedValueOnce(full);
  open();
  expect(mocks.loadLink).not.toHaveBeenCalled();
  act(() => mocks.viewer.mock.lastCall?.[0].onActivate(deferred.data));
  await screen.findByText("Network interrupted");
  fireEvent.click(screen.getByRole("button", {name:"Try Again"}));
  await screen.findByRole("button", {name:"Saved destination"});
  expect(mocks.loadLink).toHaveBeenLastCalledWith({sheetId, id:entity.id, revision:entity.revision});
});

it("resolves an unloaded link before saving style edits so destinations cannot be erased", async () => {
  const entity = existingMarkup();
  if (entity.kind !== "markup") throw Error("fixture");
  const full = { ...entity, data: { ...entity.data, type: "link" as const, links: [{label:"Saved destination", url:"/jobs"}] } };
  const deferred = { ...full, data: { ...full.data, links: undefined, deferredLinks: {id:entity.id, revision:entity.revision, count:1} } };
  mocks.data!.entities = [deferred];
  mocks.loadLink.mockResolvedValue(full);
  open();
  act(() => mocks.viewer.mock.lastCall?.[0].onUpdate(entity.id, { ...deferred.data, stroke:"#000000" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
  expect(mocks.save.mock.lastCall?.[0]).toMatchObject({data:{stroke:"#000000",links:full.data.links}});
  expect((mocks.save.mock.lastCall?.[0] as {data:{deferredLinks?:unknown}}).data.deferredLinks).toBeUndefined();
});

it("explains an uncached offline hyperlink without attempting a network request", async () => {
  const entity = existingMarkup();
  if (entity.kind !== "markup") throw Error("fixture");
  const deferred = { ...entity.data, type: "link" as const, deferredLinks: {id:entity.id, revision:entity.revision, count:1} };
  mocks.data!.entities = [{...entity,data:deferred}];
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  open();
  act(() => mocks.viewer.mock.lastCall?.[0].onActivate(deferred));
  await screen.findByText(/These destinations are not saved offline/);
  expect(mocks.loadLink).not.toHaveBeenCalled();
});


it("keeps only the full-screen and layers corner controls in quick-wheel mode", () => {
  const onFullscreen = vi.fn();
  render(<DrawingWorkspace fullscreen jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} onFullscreen={onFullscreen} />);
  expect(screen.queryByRole("toolbar", { name: "Drawing tools" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
  expect(onFullscreen).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Layers" }));
  expect(screen.getByRole("complementary", { name: "Drawing tools panel" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "F10", shiftKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Measure" }));
  expect(screen.getByRole("button", { name: "Done" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Full screen" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Layers" })).toBeVisible();
});


it("backs out of layers and then the active drawing tool before navigating to the parent", () => {
  const parent = vi.fn();
  function Host() {
    useHeaderBackOverride(parent, { priority: 10 });
    return <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />;
  }
  render(<Host />);
  fireEvent.click(screen.getByRole("button", {name: "Measure"}));
  fireEvent.click(screen.getByRole("button", {name: "Layers"}));
  act(() => { runHeaderBackOverride(); });
  expect(screen.queryByRole("complementary", {name: "Drawing tools panel"})).toBeNull();
  expect(parent).not.toHaveBeenCalled();
  expect(mocks.viewer.mock.lastCall?.[0].toolControls.modeRequest.mode).toBe("measure");
  act(() => { runHeaderBackOverride(); });
  expect(mocks.viewer.mock.lastCall?.[0].toolControls.modeRequest.mode).toBe("idle");
  expect(parent).not.toHaveBeenCalled();
  act(() => { runHeaderBackOverride(); });
  expect(parent).toHaveBeenCalledOnce();
});

it("closes the markup chooser before allowing page navigation", () => {
  const parent = vi.fn();
  function Host() {
    useHeaderBackOverride(parent);
    return <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />;
  }
  render(<Host />);
  fireEvent.click(screen.getByRole("button", {name: "Markup"}));
  act(() => { runHeaderBackOverride(); });
  expect(parent).not.toHaveBeenCalled();
  act(() => { runHeaderBackOverride(); });
  expect(parent).toHaveBeenCalledOnce();
});


it("closes More before navigating away from a base-state drawing", () => {
  const parent = vi.fn();
  function Host() {
    useHeaderBackOverride(parent);
    return <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} />;
  }
  render(<Host />); openMenu("More");
  act(() => { runHeaderBackOverride(); });
  expect(screen.getByRole("button", { name: /Expand all actions|Collapse actions/ })).toHaveAttribute("aria-expanded", "false");
  expect(parent).not.toHaveBeenCalled();
  act(() => { runHeaderBackOverride(); });
  expect(parent).toHaveBeenCalledOnce();
});


it("raises the floating menu and Done above the selected toolbar and follows its height", async () => {
  let top = 650;
  const observers = new Set<() => void>();
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) {}
    observe() { observers.add(this.callback); }
    disconnect() { observers.delete(this.callback); }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const bar = this.getAttribute("aria-label") === "Selected markup actions";
    return { x: 0, y: bar ? top : 0, top: bar ? top : 0, bottom: 800, left: 0, right: 390, width: 390, height: bar ? 800 - top : 800, toJSON: () => ({}) };
  });
  open(true);
  const viewer = () => mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
  // Start an explicit drawing tool through the wheel.
  fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "ContextMenu" });
  fireEvent.click(screen.getByRole("button", { name: "Markup" }));
  fireEvent.click(screen.getByRole("button", { name: "Ellipse" }));
  const entity = existingMarkup();
  if (entity.kind !== "markup") throw Error("Expected markup");
  act(() => viewer().onCreate?.({ ...entity.data, type: "ellipse" }));
  const bar = await screen.findByRole("toolbar", { name: "Selected markup actions" });
  const area = bar.closest<HTMLElement>("[data-drawing-tool-area]")!;
  expect(area.style.getPropertyValue("--drawing-selection-clearance")).toBe("150px");
  for (const name of ["Tool Controls", "Done"]) {
    expect(screen.getByRole("button", { name }).style.bottom).toContain("--drawing-selection-clearance");
  }
  top = 590;
  act(() => observers.forEach(callback => callback()));
  expect(area.style.getPropertyValue("--drawing-selection-clearance")).toBe("210px");
  act(() => viewer().onSelect?.(null));
  expect(area.style.getPropertyValue("--drawing-selection-clearance")).toBe("");
});


it.each([false, true])("keeps selection and style menus out of the drawing layout (fullscreen=%s)", async (fullscreen) => {
  mocks.data!.entities = [existingMarkup()];
  const dock = document.createElement("div");
  document.body.appendChild(dock);
  const initialViewport = { center: { x: 0.3, y: 0.7 }, zoom: 4 };
  const onViewportChange = vi.fn();
  const view = render(<DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()}
    fullscreen={fullscreen} toolbarContainer={dock} initialViewport={initialViewport} onViewportChange={onViewportChange} />);
  const viewer = () => mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
  if (fullscreen) {
    fireEvent.keyDown(screen.getByLabelText("Drawing workspace"), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "Markup" }));
    fireEvent.click(screen.getByRole("button", { name: "Ellipse" }));
    fireEvent.click(screen.getByRole("button", { name: "Tool Controls" }));
  } else chooseTool("ellipse");
  const dockContent = Array.from(dock.children);
  const area = screen.getByRole("toolbar", { name: "Markup controls" }).closest("[data-drawing-tool-area]");
  const expectFloating = (label: string) => {
    const bar = screen.getByRole("toolbar", { name: label });
    expect(bar).toHaveClass("absolute");
    expect(bar.closest("[data-drawing-tool-area]")).toBe(area);
    expect(dock.contains(bar)).toBe(false);
    expect(Array.from(dock.children)).toEqual(dockContent);
    expect(viewer().initialViewport).toEqual(initialViewport);
    expect(onViewportChange).not.toHaveBeenCalled();
  };
  expectFloating("Markup controls");
  act(() => viewer().onSelect?.(entityId));
  expectFloating("Selected markup actions");
  expect(screen.queryByText("Read only")).toBeNull();
  act(() => viewer().onSelect?.(null));
  expect(screen.queryByRole("toolbar", { name: "Selected markup actions" })).toBeNull();
  expect(Array.from(dock.children)).toEqual(dockContent);
  expect(viewer().initialViewport).toEqual(initialViewport);
  expect(onViewportChange).not.toHaveBeenCalled();
  view.unmount();
  dock.remove();
});


it.each([false, true])("locks and unlocks a markup from its basic menu (fullscreen=%s)", async (fullscreen) => {
  mocks.data!.entities = [existingMarkup()];
  open(fullscreen);
  const viewer = () => mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
  fireEvent.click(screen.getByRole("button", { name: "Select first annotation" }));
  const bar = screen.getByRole("toolbar", { name: "Selected markup actions" });
  fireEvent.click(within(bar).getByRole("button", { name: "Lock markup" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.lastCall?.[0]).toMatchObject({ id: entityId, data: { locked: true } });
  await waitFor(() => expect(within(bar).getByRole("button", { name: "Unlock markup" })).toBeEnabled());
  expect(within(bar).getByRole("button", { name: "Unlock markup" })).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Move", "Resize", "Delete markup", "Blue", "Fill"]) {
    expect(within(bar).getByRole("button", { name })).toBeDisabled();
  }
  expect(viewer().canEditAnnotation?.(entityId)).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Move selected annotation" }));
  expect(mocks.save).toHaveBeenCalledOnce();
  act(() => viewer().onSelect?.(null));
  fireEvent.click(screen.getByRole("button", { name: "Select first annotation" }));
  const reopened = screen.getByRole("toolbar", { name: "Selected markup actions" });
  expect(within(reopened).getByRole("button", { name: "Unlock markup" })).toBeEnabled();
  fireEvent.click(within(reopened).getByRole("button", { name: "Unlock markup" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.lastCall?.[0]).toMatchObject({ id: entityId, data: { locked: false } });
  await waitFor(() => expect(within(reopened).getByRole("button", { name: "Move" })).toBeEnabled());
});

it("does not let a reader unlock someone else's markup", () => {
  mocks.data!.canManage = false;
  const entity = existingMarkup("published");
  if (entity.kind !== "markup") throw Error("Expected markup");
  mocks.data!.entities = [{ ...entity, authorId: "other", data: { ...entity.data, locked: true } }];
  open();
  fireEvent.click(screen.getByRole("button", { name: "Select first annotation" }));
  expect(screen.queryByRole("button", { name: "Unlock markup" })).toBeNull();
  expect(screen.getByText("Read only")).toBeVisible();
});


it("keeps transient save status out of the bottom toolbar layout", async () => {
  let finish!: (entity: DrawingEntity) => void;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  open();
  const container = screen.getByRole("toolbar", { name: "Drawing tools" });
  chooseTool("ellipse");
  const entity = existingMarkup();
  if (entity.kind !== "markup") throw Error("Expected markup");
  const viewer = () => mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
  act(() => viewer().onCreate?.({ ...entity.data, type: "ellipse" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  expect(screen.getByRole("status")).toHaveClass("sr-only");
  expect(container.querySelector("[data-action-bar-label]")).toBeNull();
  await act(async () => { finish(entity); });
  await waitFor(() => expect(screen.getByRole("status")).toBeEmptyDOMElement());
  expect(container.querySelector("[data-action-bar-label]")).toBeNull();
});


it("removes docked controls when a retained page is hidden and restores only the active page", () => {
  const dock = document.createElement("div");
  document.body.append(dock);
  const pages = (active: number) => <>{[0, 1, 2].map(page =>
    <Activity key={page} mode={page === active ? "visible" : "hidden"}>
      <DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} scrollPages toolbarContainer={dock} />
    </Activity>
  )}</>;
  const view = render(pages(0));
  for (const active of [1, 2, 0, 2, 1]) {
    view.rerender(pages(active));
    expect(within(dock).getAllByRole("button", { name: "Measure" })).toHaveLength(1);
    expect(dock.querySelectorAll('[data-action-bar]')).toHaveLength(1);
  }
  fireEvent.click(within(dock).getByRole("button", { name: "Measure" }));
  expect(within(dock).getByRole("button", { name: "Measure", pressed: true })).toBeVisible();
  view.unmount();
  expect(dock).toBeEmptyDOMElement();
  dock.remove();
});

it("keeps both saved and original hyperlinks disabled until their layer is enabled", () => {
  const base = existingMarkup();
  const link = {...base, data:{...base.data,type:"link"}} as DrawingEntity;
  mocks.data!.entities = [link];
  open();
  expect(mocks.viewer.mock.lastCall?.[0].onPdfLink).toBeUndefined();
  expect(mocks.viewer.mock.lastCall?.[0].annotations).toEqual([]);
  enableHyperlinks();
  expect(mocks.viewer.mock.lastCall?.[0].onPdfLink).toEqual(expect.any(Function));
  expect(mocks.viewer.mock.lastCall?.[0].annotations).toEqual([link]);
  enableHyperlinks();
  expect(mocks.viewer.mock.lastCall?.[0].onPdfLink).toBeUndefined();
  expect(mocks.viewer.mock.lastCall?.[0].annotations).toEqual([]);
});

describe("instant private saved view name integration", () => {
  const clients: QueryClient[] = [];
  const privateView = (): DrawingEntity => ({...existingMarkup(), kind: "view", data: {name: "Old saved view", sourceSheetId: sheetId, center: {x: .5, y: .5}, zoom: 1}});
  function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
  }
  function mountName(store: DrawingOfflineStore | null = null, requireFreshDocumentRead = false) {
    mocks.instantNames = true;
    mocks.account = {userId: "tim", accountKey: "org:tim", store};
    mocks.data = {...fixture(), entities: [privateView()]};
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}}); clients.push(client);
    const key = ["drawing", {sheetId, omitHyperlinks: true}];
    client.setQueryData(key, mocks.data);
    client.setQueryData(["drawing", {sheetId}], mocks.data);
    const tree = (hidden = false) => <QueryClientProvider client={client}><Activity mode={hidden ? "hidden" : "visible"}><DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()} requireFreshDocumentRead={requireFreshDocumentRead} /></Activity></QueryClientProvider>;
    const result = render(tree());
    return {...result, client, key, tree};
  }
  async function rename() {
    fireEvent.click(screen.getByRole("button", {name: "Select saved view"}));
    fireEvent.click(await screen.findByRole("button", {name: "Edit"}));
    fireEvent.change(screen.getByLabelText("Saved view name"), {target: {value: "New saved view"}});
    fireEvent.click(screen.getByRole("button", {name: "Save"}));
  }
  afterEach(() => {for (const client of clients.splice(0)) client.clear();});
  it("online document cached capabilities/manual writes cannot unlock editing; fresh response does", async () => {
    const {client, key} = mountName(null, true);
    fireEvent.click(screen.getByRole("button", {name: "Select saved view"}));
    expect(screen.queryByRole("button", {name: "Edit"})).toBeNull();
    act(() => {client.setQueryData(key, client.getQueryData(key));});
    expect(screen.queryByRole("button", {name: "Edit"})).toBeNull();
    await act(async () => {await client.fetchQuery({queryKey: key, staleTime: 0, queryFn: async () => mocks.data!});});
    expect(await screen.findByRole("button", {name: "Edit"})).toBeVisible();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("manual authority loss disables an open document form and blocks the saved-view fast path", async () => {
    const {client, key} = mountName(null, true);
    await act(async () => {await client.fetchQuery({queryKey: key, staleTime: 0, queryFn: async () => mocks.data!});});
    fireEvent.click(screen.getByRole("button", {name: "Select saved view"}));
    fireEvent.click(await screen.findByRole("button", {name: "Edit"}));
    fireEvent.change(screen.getByLabelText("Saved view name"), {target: {value: "Unconfirmed draft"}});
    act(() => {client.setQueryData(key, client.getQueryData(key));});
    expect(screen.getByRole("button", {name: "Checking access…"})).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Saved view name").closest("form")!);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Saved view name")).toHaveValue("Unconfirmed draft");
  });
  it("Activity resume revokes document authority and a retained write callback cannot dispatch", async () => {
    const {client, key, tree, rerender} = mountName(null, true);
    await act(async () => {await client.fetchQuery({queryKey: key, staleTime: 0, queryFn: async () => mocks.data!});});
    const previousViewer = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    expect(previousViewer.onScaleChange).toBeDefined();
    rerender(tree(true)); rerender(tree());
    fireEvent.click(screen.getByRole("button", {name: "Select saved view"}));
    expect(screen.queryByRole("button", {name: "Edit"})).toBeNull();
    await act(async () => {await previousViewer.onScaleChange?.({unit: "m", unitsPerSheetWidth: 120});});
    expect(mocks.setScale).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => {await client.fetchQuery({queryKey: key, staleTime: 0, queryFn: async () => mocks.data!});});
    expect(await screen.findByRole("button", {name: "Edit"})).toBeEnabled();
  });
  it("closes form and changes surviving selected/list title before response, restores refused name draft", async () => {
    const request = deferred<DrawingEntity>(); mocks.save.mockReturnValue(request.promise);
    mountName(); await rename();
    expect(screen.queryByLabelText("Saved view name")).toBeNull();
    expect(screen.getByRole("heading", {name: "New saved view"})).toBeVisible();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    panel("views");
    expect(screen.getByRole("button", {name: /New saved view/})).toBeVisible();
    fireEvent.click(screen.getByRole("button", {name: "Select saved view"}));
    await act(async () => {request.reject(new Error("Refused"));});
    expect(await screen.findByLabelText("Saved view name")).toHaveValue("New saved view");
    panel("views");
    expect(screen.getByRole("button", {name: /Old saved view/})).toBeVisible();
    expect(screen.queryByRole("button", {name: /New saved view/})).toBeNull();
  });
  it("retains a newer server revision and never reopens obsolete refused name", async () => {
    const request = deferred<DrawingEntity>(); mocks.save.mockReturnValue(request.promise);
    const {client, key} = mountName(); await rename();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const before = client.getQueryData<Workspace>(key)!;
    await act(async () => {client.setQueryData(key, {...before, entities: [{...privateView(), revision: 9, data: {name: "Remote saved view", sourceSheetId: sheetId, center: {x: .5,y: .5}, zoom: 1}} as DrawingEntity]});});
    await screen.findByRole("heading", {name: "Remote saved view"});
    await act(async () => {request.reject(new Error("Conflict"));});
    expect(screen.queryByLabelText("Saved view name")).toBeNull();
    expect(screen.getByRole("heading", {name: "Remote saved view"})).toBeVisible();
  });
  it.each(["refused", "newer", "account"] as const)("never writes preview through delayed snapshot completion (%s)", async (mode) => {
    const network = deferred<DrawingEntity>(), disk = deferred<Workspace | null>();
    mocks.save.mockReturnValue(network.promise);
    let delay = false;
    const readSnapshot = vi.fn(async () => delay ? disk.promise : null);
    const saveSnapshot = vi.fn(async () => undefined);
    const store = {readSnapshot, saveSnapshot, resolveAssetUrl: vi.fn(async (url: string) => url)} as unknown as DrawingOfflineStore;
    const {client, key, unmount} = mountName(store);
    await waitFor(() => expect(saveSnapshot).toHaveBeenCalled());
    saveSnapshot.mockClear(); delay = true;
    // Start a disk merge before the optimistic edit, then hold its completion.
    await act(async () => {client.setQueryData<Workspace>(key, previous => previous && ({...previous, revision: "before-edit"}));});
    const readCount = readSnapshot.mock.calls.length;
    await rename();
    expect(readSnapshot).toHaveBeenCalledTimes(readCount);
    expect(saveSnapshot).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    if (mode === "refused") await act(async () => {network.reject(new Error("Refused"));});
    else if (mode === "account") {
      mocks.account = {userId: "other", accountKey: "org:other", store: null}; client.clear(); unmount();
      await act(async () => {network.resolve({...privateView(), revision: 5});});
    } else {
      await act(async () => {network.resolve({...privateView(), revision: 5, data: {name: "Confirmed saved view", sourceSheetId: sheetId, center: {x: .5,y: .5}, zoom: 1}} as DrawingEntity);});
      await act(async () => {client.setQueryData<Workspace>(key, previous => previous && ({...previous, entities: [{...privateView(), revision: 9, data: {name: "Remote saved view", sourceSheetId: sheetId, center: {x: .5,y: .5}, zoom: 1}} as DrawingEntity]}));});
    }
    await act(async () => {disk.resolve(null);});
    const written = saveSnapshot.mock.calls as unknown as Array<[string, Workspace]>;
    expect(written.some(([, value]) => value.entities.some(entity => entity.kind === "view" && entity.data.name === "New saved view"))).toBe(false);
    if (mode === "account") expect(saveSnapshot).not.toHaveBeenCalled();
    if (mode === "newer") {
      expect(written.some(([, value]) => value.entities.some(entity => entity.kind === "view" && entity.data.name === "Confirmed saved view"))).toBe(false);
      await waitFor(() => expect((saveSnapshot.mock.calls as unknown as Array<[string, Workspace]>).some(([, value]) => value.entities.some(entity => entity.kind === "view" && entity.data.name === "Remote saved view"))).toBe(true));
    }
  });
});


describe("real scale acknowledgement controller", () => {
  function mountScale() {
    mocks.realScale = true;mocks.instantNames = true;
    mocks.account = {accountKey:"org:tim",userId:"tim",store:null};
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    client.setQueryData(["drawing",{sheetId}],mocks.data);
    client.setQueryData(["drawing",{sheetId,omitHyperlinks:true}],mocks.data);
    const view=render(<QueryClientProvider client={client}><DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()}/></QueryClientProvider>);
    return {client,view};
  }
  it("acknowledges scale promptly even when authoritative refresh never resolves", async () => {
    mocks.invalidate.mockReturnValueOnce(new Promise(() => undefined));
    const {client}=mountScale();
    fireEvent.click(screen.getByRole("button",{name:"Calibrate sample"}));
    await waitFor(()=>expect(mocks.scaleResult).toHaveBeenCalledWith(expect.objectContaining({accepted:true,applyToView:true})));
    expect(mocks.setScale).toHaveBeenCalledWith({sheetId,scale:{unit:"m",unitsPerSheetWidth:120},expectedAccountKey:"org:tim"});
    expect(screen.getByTestId("shared-scale")).toHaveTextContent("120");
    cleanup();client.clear();
  });
  it("does not finish an older scale after a newer real metadata ACK whose cache patch lags", async () => {
    let scaleDone!: (value: DrawingMetadata)=>void;
    mocks.setScale.mockReturnValue(new Promise(resolve=>{scaleDone=resolve;}));
    const {client}=mountScale();
    mocks.metadata.mockResolvedValueOnce({...fixture().metadata,revision:10,title:"Server checked",scale:{unit:"m",unitsPerSheetWidth:240}});
    mocks.dropMetadataPatch = true;
    openMenu("More");fireEvent.click(screen.getByRole("button",{name:"Super scale"}));
    fireEvent.click(screen.getByRole("button",{name:"Start new Super scale"}));
    fireEvent.click(screen.getByRole("button",{name:"Set scale"}));
    fireEvent.click(screen.getByRole("button",{name:"Calibrate sample"}));
    await waitFor(()=>expect(mocks.scaleResult).toHaveBeenCalledWith(true));
    const props = mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;
    act(()=>props.toolControls?.onCalibrationEnd?.(true));
    mocks.scaleResult.mockClear();
    panel("details");
    expect(screen.getByLabelText("Title")).toHaveValue("Server checked");
    expect(client.getQueryData<Workspace>(["drawing",{sheetId}])?.metadata.revision).toBe(7);
    fireEvent.click(screen.getByRole("button",{name:"Calibrate sample"}));
    await waitFor(()=>expect(mocks.setScale).toHaveBeenCalledOnce());
    await act(async()=>scaleDone({...fixture().metadata,revision:9,scale:{unit:"m",unitsPerSheetWidth:120}}));
    await waitFor(()=>expect(mocks.scaleResult).toHaveBeenCalledWith(expect.objectContaining({accepted:true,applyToView:false})));
    expect(screen.getByLabelText("Title")).toHaveValue("Server checked");
    expect(client.getQueryData<Workspace>(["drawing",{sheetId}])?.metadata.revision).toBe(7);
    cleanup();client.clear();
  });
});

describe("shared issue real-controller integration",()=>{
  function issue():DrawingEntity {return {id:entityId,sheetId,kind:"issue",data:{sourceSheetId:sheetId,type:"issue",point:{x:.5,y:.5},title:"Shared issue",body:"",status:"open",assigneeId:null,dueDate:null,links:[]},revision:4,visibility:"published",authorId:"tim",authorName:"Tim",createdAt:"real",updatedAt:"real",comments:[]};}
  async function mountIssue(){
    mocks.realSharedIssue=true;mocks.instantNames=true;mocks.account={accountKey:"org:tim",userId:"tim",store:null};mocks.data={...fixture(),entities:[issue()]};
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});client.setQueryData(["drawing",{sheetId}],mocks.data);client.setQueryData(["drawing",{sheetId,omitHyperlinks:true}],mocks.data);
    const view=render(<QueryClientProvider client={client}><DrawingWorkspace jobId={jobId} sheet={sheet} onOpenSheet={vi.fn()}/></QueryClientProvider>);
    const props=mocks.viewer.mock.lastCall?.[0] as ComponentProps<typeof DrawingSheetViewer>;act(()=>props.onSelect?.(entityId));
    fireEvent.click(await screen.findByRole("button",{name:"Edit"}));
    fireEvent.change(screen.getByLabelText("Issue title"),{target:{value:"New shared title"}});
    return {client,view};
  }
  it("keeps a real accepted issue saved when refresh hangs or rejects",async()=>{
    let finish!:(entity:DrawingEntity)=>void;mocks.save.mockReturnValue(new Promise(resolve=>{finish=resolve;}));mocks.invalidate.mockReturnValueOnce(new Promise(()=>undefined));
    const {client,view}=await mountIssue();fireEvent.click(screen.getByRole("button",{name:"Save"}));
    expect(screen.getByRole("button",{name:"Saving…"})).toBeDisabled();await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());
    await act(async()=>finish({...issue(),revision:5,data:{...(issue().data as Extract<DrawingEntity,{kind:"issue"}>["data"]),title:"New shared title"}} as DrawingEntity));
    await waitFor(()=>expect(screen.queryByRole("button",{name:"Saving…"})).toBeNull());
    expect(screen.queryByText(/unsaved item/)).toBeNull();expect(screen.queryByLabelText("Issue title")).toBeNull();expect(screen.getByRole("heading",{name:"New shared title"})).toBeVisible();view.unmount();client.clear();
  });
  it("uncertain ACK retains draft and offers only a read recovery without copy/retry writes",async()=>{
    mocks.save.mockRejectedValue(Error("ACK lost"));const {client,view}=await mountIssue();fireEvent.click(screen.getByRole("button",{name:"Save"}));
    await screen.findByRole("button",{name:"Check latest issue"});expect(screen.getByLabelText("Issue title")).toHaveValue("New shared title");expect(screen.queryByRole("button",{name:"Save as new private copy"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Save"}));expect(mocks.save).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button",{name:"Check latest issue"}));await waitFor(()=>expect(mocks.readWorkspace).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Issue title")).toHaveValue("New shared title");expect(mocks.save).toHaveBeenCalledOnce();view.unmount();client.clear();
  });
});
