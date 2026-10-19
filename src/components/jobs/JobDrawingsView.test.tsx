import { useRef, type Ref } from "react";
import { DRAWING_DESTINATION_EVENT, makeSnapshotSource } from "~/lib/snapshot-source";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHeaderBackOverride } from "~/lib/header-back-events";

const state = vi.hoisted(() => ({
  account: null as null | { accountKey: string; store: Record<string, ReturnType<typeof vi.fn>> },
  fetchSet: vi.fn(),
  fetchWorkspace: vi.fn(),
  canManage: true,
  canDelete: undefined as boolean | undefined,
  sets: [] as Array<{
    id: string;
    name: string;
    sheetCount: number;
    coverImageUrl: string | null;
    updatedAt: Date;
  }>,
  sheets: [] as Array<{
    id: string;
    name: string;
    imageUrl: string;
    width: number;
    height: number;
    sourceFilename: string | null;
  }>,
  calls: [] as Array<[string, unknown]>,
  summaries: [] as Array<{
    sheetId: string;
    favorite: boolean;
    metadata: {
      number: string;
      title: string;
      discipline: string;
      tags: string[];
      status: string;
    };
  }>,
  upload: vi.fn(),
  refreshIdentities: vi.fn(),
  prefetch: vi.fn(async () => undefined),
}));
vi.mock("~/trpc/react", () => {
  const mutation = (name: string) => ({
    useMutation: (
      options: { onSuccess?: (result: unknown) => unknown } = {},
    ) => ({
      isPending: false,
      mutate: (input: unknown) => {
        state.calls.push([name, input]);
        if (name === "renameSheet") {
          const renamed = input as { sheetId: string; name: string };
          state.sheets = state.sheets.map(sheet => sheet.id === renamed.sheetId ? { ...sheet, name: renamed.name } : sheet);
        }
        void options.onSuccess?.({ id: "new-set" });
      },
    }),
  });
  return {
    api: {
      useUtils: () => ({
        drawingsWorkspace: { list: { invalidate: state.refreshIdentities }, get: { invalidate: vi.fn(), prefetch: state.prefetch, fetch: state.fetchWorkspace } },
        drawings: {
          listSets: { invalidate: vi.fn() },
          getSet: { invalidate: vi.fn(), fetch: state.fetchSet },
        },
      }),
      drawingsWorkspace: {
        list: { useQuery: () => ({ data: state.summaries }) },
        favorite: mutation("favorite"),
        metadata: mutation("metadata"),
      },
      drawings: {
        listSets: {
          useQuery: () => ({
            isLoading: false,
            data: { canManage: state.canManage, canUpload: state.canManage, canDelete: state.canDelete, sets: state.sets },
          }),
        },
        getSet: {
          useQuery: (input: { setId: string }) => ({
            isLoading: false,
            data: input.setId
              ? {
                  canManage: state.canManage,
                  canUpload: state.canManage,
                  canDelete: state.canDelete,
                  set: { id: input.setId, jobId: "job", name: "Mechanical" },
                  sheets: state.sheets,
                }
              : undefined,
          }),
        },
        createSet: mutation("createSet"),
        renameSet: mutation("renameSet"),
        deleteSet: mutation("deleteSet"),
        renameSheet: mutation("renameSheet"),
        deleteSheet: mutation("deleteSheet"),
      },
    },
  };
});
vi.mock("~/lib/upload-drawings", () => ({ uploadDrawings: state.upload }));
vi.mock("~/components/ui/app-dialogs", () => ({
  confirmAction: vi.fn(async () => true),
  notify: vi.fn(),
}));
vi.mock("./DrawingWorkspace", () => ({
  DrawingWorkspace: ({ sheet, initialViewport, onViewportChange, onFullscreen, fullscreenRef }: {
    sheet: { name: string };
    initialViewport?: { center: { x: number; y: number }; zoom: number } | null;
    onViewportChange?: (viewport: { center: { x: number; y: number }; zoom: number }) => void;
    onFullscreen?: () => void;
    fullscreenRef?: Ref<HTMLButtonElement>;
  }) => {
    const mountedView = useRef(initialViewport);
    return (
    <div>
      <span data-testid="mounted-view">{JSON.stringify(mountedView.current ?? null)}</span>
      <span>Viewing {sheet.name}</span>
      <span data-testid="inherited-view">{JSON.stringify(initialViewport ?? null)}</span>
      <button onClick={() => onViewportChange?.({ center: { x: 0.2, y: 0.7 }, zoom: 3 })}>Zoom and pan sample</button>
      {onFullscreen && <button ref={fullscreenRef} aria-label="Full screen" onClick={onFullscreen} />}
    </div>
  );},
}));
vi.mock("./DrawingAccountProvider", () => ({ useDrawingAccount: () => state.account }));

vi.mock("~/lib/drawing-pdf-offline-runtime", () => ({ warmDrawingPdfRuntime: vi.fn(async () => undefined) }));
vi.mock("~/lib/drawing-offline", () => ({ collectDrawingOfflineUrls: vi.fn(async (urls: string[]) => [...urls, "/original.pdf"]) }));

import { JobDrawingsView } from "./JobDrawingsView";

beforeEach(() => {
  state.account = null;
  window.history.replaceState({}, "", "/");
  state.summaries = [];
  state.canManage = true;
  state.canDelete = undefined;
  state.sets = [
    {
      id: "set-1",
      name: "Mechanical",
      sheetCount: 2,
      coverImageUrl: "/a.webp",
      updatedAt: new Date(),
    },
  ];
  state.sheets = [
    {
      id: "s1",
      name: "M-101",
      imageUrl: "/1.webp",
      width: 10,
      height: 10,
      sourceFilename: "m.pdf",
    },
    {
      id: "s2",
      name: "M-102",
      imageUrl: "/2.webp",
      width: 10,
      height: 10,
      sourceFilename: "m.pdf",
    },
  ];
  state.calls = [];
  state.prefetch.mockClear();
  state.upload.mockReset().mockResolvedValue([]);
  state.refreshIdentities.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Drawings", () => {
  const openDrawing = () => {
    const view = render(<JobDrawingsView jobId="job" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Mechanical" }));
    fireEvent.click(screen.getByRole("button", { name: "Open M-101" }));
    return view;
  };

  const nativeFullscreen = () => {
    let element: Element | null = null;
    const elementDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => element });
    const request = vi.fn(async function(this: HTMLElement) {
      element = this;
      fireEvent(document, new Event("fullscreenchange"));
    });
    const exit = vi.fn(async () => {
      element = null;
      fireEvent(document, new Event("fullscreenchange"));
    });
    const requestDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen");
    const exitDescriptor = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: request });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    return {
      request, exit,
      browserExit: () => { element = null; fireEvent(document, new Event("fullscreenchange")); },
      restore: () => {
        cleanup();
        for (const [object, name, descriptor] of [[document, "fullscreenElement", elementDescriptor], [HTMLElement.prototype, "requestFullscreen", requestDescriptor], [document, "exitFullscreen", exitDescriptor]] as const) {
          if (descriptor) Object.defineProperty(object, name, descriptor);
          else Reflect.deleteProperty(object, name);
        }
      },
    };
  };

  it("expands the existing drawing with an exit button, preserves its zoom, and exits on back before closing the sheet", () => {
    openDrawing();
    fireEvent.click(screen.getByRole("button", { name: "Zoom and pan sample" }));
    const workspace = screen.getByText("Viewing M-101");
    const enter = screen.getByRole("button", { name: "Full screen" });
    fireEvent.click(enter);
    const surface = workspace.closest('[data-drawing-fullscreen]')!;
    expect(surface).toHaveAttribute("data-drawing-fullscreen", "true");
    expect(surface).toHaveClass("inset-0", "[&_[data-drawing-chrome]]:hidden");
    expect(screen.getByRole("button", { name: "Exit full screen" })).toHaveFocus();
    expect(screen.getByText("Viewing M-101")).toBe(workspace);
    act(() => void runHeaderBackOverride());
    expect(surface).toHaveAttribute("data-drawing-fullscreen", "false");
    expect(screen.getByLabelText("Drawing zoom")).toHaveTextContent("300%");
    expect(enter).toHaveFocus();
    expect(screen.getByText("Viewing M-101")).toBe(workspace);
    act(() => void runHeaderBackOverride());
    expect(screen.getByRole("button", { name: "Open M-101" })).toBeInTheDocument();
  });

  it("exits expanded viewing with Escape or its exit button without navigating away", () => {
    openDrawing();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(screen.getByText("Viewing M-101")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();
  });

  it("requests native fullscreen and synchronizes browser-initiated exit", async () => {
    const native = nativeFullscreen();
    try {
      openDrawing();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Full screen" })));
      expect(native.request).toHaveBeenCalledWith({ navigationUI: "hide" });
      expect(document.fullscreenElement).toHaveAttribute("data-drawing-fullscreen", "true");
      act(native.browserExit);
      expect(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();
      expect(screen.getByRole("button", { name: "Full screen" })).toHaveFocus();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Full screen" })));
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Exit full screen" })));
      expect(native.exit).toHaveBeenCalledOnce();
      expect(document.fullscreenElement).toBeNull();
    } finally { native.restore(); }
  });

  it("retains expanded viewing when native fullscreen is rejected", async () => {
    const native = nativeFullscreen();
    native.request.mockRejectedValueOnce(new Error("Fullscreen unavailable"));
    try {
      openDrawing();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Full screen" })));
      expect(screen.getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();
      expect(document.fullscreenElement).toBeNull();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();
    } finally { native.restore(); }
  });

  it("does not reopen fullscreen after a pending request is granted following Exit", async () => {
    const native = nativeFullscreen();
    const grant = native.request.getMockImplementation()!;
    let finish!: () => Promise<void>;
    native.request.mockImplementationOnce(function(this: HTMLElement) {
      const target = this;
      return new Promise<void>((resolve) => { finish = async () => { await grant.call(target); resolve(); }; });
    });
    try {
      openDrawing();
      fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
      fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
      await act(finish);
      await waitFor(() => expect(document.fullscreenElement).toBeNull());
      expect(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();
    } finally { native.restore(); }
  });

  it("exits native fullscreen when the drawing page unmounts", async () => {
    const native = nativeFullscreen();
    try {
      const view = openDrawing();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Full screen" })));
      view.unmount();
      expect(native.exit).toHaveBeenCalled();
      expect(document.fullscreenElement).toBeNull();
    } finally { native.restore(); }
  });
  it("carries the current view through Next and Previous, including rapid navigation, and clears it when opening from the folder", () => {
    state.sheets.push({ ...state.sheets[1]!, id: "s3", name: "M-103" });
    render(<JobDrawingsView jobId="job" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Mechanical" }));
    fireEvent.click(screen.getByRole("button", { name: "Open M-101" }));
    expect(screen.getByTestId("inherited-view")).toHaveTextContent("null");
    fireEvent.click(screen.getByRole("button", { name: "Zoom and pan sample" }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    const expected = JSON.stringify({ center: { x: 0.2, y: 0.7 }, zoom: 3 });
    expect(screen.getByText("Viewing M-102")).toBeInTheDocument();
    expect(screen.getByTestId("inherited-view")).toHaveTextContent(expected);
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Viewing M-103")).toBeInTheDocument();
    expect(screen.getByTestId("inherited-view")).toHaveTextContent(expected);
    fireEvent.click(screen.getByRole("button", { name: /Previous/ }));
    expect(screen.getByTestId("inherited-view")).toHaveTextContent(expected);
    act(() => void runHeaderBackOverride());
    fireEvent.click(screen.getByRole("button", { name: "Open M-102" }));
    expect(screen.getByTestId("inherited-view")).toHaveTextContent("null");
  });

  it("shows the current drawing name in the bottom bar and renames the sheet being viewed", async () => {
    render(<JobDrawingsView jobId="job" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Mechanical" }));
    fireEvent.click(screen.getByRole("button", { name: "Open M-101" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename drawing M-101" }));
    expect(screen.getByRole("dialog", { name: "Rename drawing" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("M-101");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  M-101 Plumbing plan  " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(state.calls).toContainEqual(["renameSheet", { sheetId: "s1", name: "M-101 Plumbing plan" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Rename drawing M-101 Plumbing plan" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: "Rename drawing M-102" }));
    expect(screen.getByLabelText("Name")).toHaveValue("M-102");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.calls.filter(([name]) => name === "renameSheet")).toHaveLength(1);
  });

  it("shows the drawing name without a rename control for viewers", () => {
    state.canManage = false;
    render(<JobDrawingsView jobId="job" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Mechanical" }));
    fireEvent.click(screen.getByRole("button", { name: "Open M-101" }));
    expect(screen.getByText("M-101")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rename drawing/ })).toBeNull();
  });
  it("opens a folder, a sheet, pages through sheets and steps back with the app bar arrow", () => {
    render(<JobDrawingsView jobId="job" />);
    expect(screen.getByText("2 drawings")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Mechanical" }));
    fireEvent.click(screen.getByRole("button", { name: "Open M-101" }));
    expect(screen.getByText("Viewing M-101")).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Viewing M-102")).toBeInTheDocument();
    act(() => void runHeaderBackOverride());
    expect(
      screen.getByRole("button", { name: "Open M-102" }),
    ).toBeInTheDocument();
    act(() => void runHeaderBackOverride());
    expect(
      screen.getByRole("button", { name: "Open Mechanical" }),
    ).toBeInTheDocument();
    expect(runHeaderBackOverride()).toBe(false);
  });

  it("creates a folder by name and uploads a PDF into the open folder", async () => {
    render(<JobDrawingsView jobId="job" />);
    fireEvent.click(screen.getAllByRole("button", { name: /New folder/ })[0]!);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  Electrical " },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    });
    expect(state.calls).toContainEqual([
      "createSet",
      { jobId: "job", name: "Electrical" },
    ]);

    // Creating opens the new folder; upload goes into it.
    state.refreshIdentities.mockClear();
    const file = new File(["%PDF-1"], "elec.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]')!;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(state.upload).toHaveBeenCalledWith("job", file, {
      drawingSetId: "new-set",
    });
    expect(state.refreshIdentities).toHaveBeenCalledWith({ jobId: "job" });
  });

  it("hides folder and upload controls from people who can't manage drawings", () => {
    state.canManage = false;
    render(<JobDrawingsView jobId="job" />);
    expect(screen.queryByRole("button", { name: /New folder/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /More actions/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Mechanical" }));
    expect(
      screen.queryByRole("button", { name: /Upload drawings/ }),
    ).toBeNull();
  });

  it("shows upload controls without deletion when upload is allowed but delete is denied", () => {
    state.canManage = true;
    state.canDelete = false;
    render(<JobDrawingsView jobId="job" />);
    expect(screen.getAllByRole("button", { name: "New folder" }).length).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions for Mechanical" }), { key: "Enter" });
    expect(screen.getByRole("menuitem", { name: "Rename folder" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete folder" })).toBeNull();

  });

  it.each([true, false])("separates sheet actions for upload=%s and the opposite deletion permission", (upload) => {
    state.canManage = upload;
    state.canDelete = !upload;
    render(<JobDrawingsView jobId="job" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Mechanical" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions for M-101" }), { key: "Enter" });
    if (upload) {
      expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    } else {
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    }
  });

  it("shows deletion without granting folder creation or renaming", () => {
    state.canManage = false;
    state.canDelete = true;
    render(<JobDrawingsView jobId="job" />);
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions for Mechanical" }), { key: "Enter" });
    expect(screen.getByRole("menuitem", { name: "Delete folder" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Rename folder" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New folder" })).toBeNull();
  });
  it("finds sheets by metadata, filters favorites and preserves access in list view", () => {
    state.summaries = [
      {
        sheetId: "s2",
        favorite: true,
        metadata: {
          number: "M-102",
          title: "Heating plan",
          discipline: "Mechanical",
          tags: ["permit"],
          status: "approved",
        },
      },
    ];
    render(<JobDrawingsView jobId="job" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Mechanical" }));
    fireEvent.change(screen.getByLabelText("Search drawings"), {
      target: { value: "permit" },
    });
    expect(screen.queryByRole("button", { name: "Open M-101" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open M-102" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search drawings"), {
      target: { value: "" },
    });
    // Filters live in the bottom bar's Filters menu.
    const openFilters = () =>
      fireEvent.keyDown(screen.getByRole("button", { name: /^Filters/ }), { key: "Enter" });
    openFilters();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Starred only" }));
    expect(screen.queryByRole("button", { name: "Open M-101" })).toBeNull();
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();
    // Grid/list switch sits beside the heading, as on material lists.
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(screen.getByText("Heating plan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unfavorite M-102" }));
    expect(state.calls).toContainEqual([
      "favorite",
      { sheetId: "s2", favorite: false },
    ]);
  });
  it("opens a notification's drawing and folder query parameters", () => {
    const sheetId = "00000000-0000-4000-8000-000000000001",
      folder = "00000000-0000-4000-8000-000000000002";
    state.sheets[0]!.id = sheetId;
    window.history.replaceState(
      {},
      "",
      `/dashboard/jobs/job/drawings?drawingSet=${folder}&drawingSheet=${sheetId}`,
    );
    render(<JobDrawingsView jobId="job" />);
    expect(screen.getByText("Viewing M-101")).toBeInTheDocument();
  });
});

 it("warms a focused sheet without opening or changing it", () => {
  render(<JobDrawingsView jobId="job" />);
  fireEvent.click(screen.getByRole("button", { name: "Open Mechanical" }));
  fireEvent.focus(screen.getByRole("button", { name: "Open M-101" }));
  expect(state.prefetch).toHaveBeenCalledWith({ sheetId: "s1" }, { staleTime: 15_000 });
  expect(screen.queryByText("Viewing M-101")).toBeNull();
 });


describe("drawing set downloads", () => {
  function offlineStore() {
    const store = {
      readSnapshot: vi.fn(async (_key: string): Promise<unknown> => null),
      saveSnapshot: vi.fn(async (_key: string, _value: unknown) => undefined),
      readAsset: vi.fn(async (_url: string): Promise<Blob | null> => null),
      resolveAssetUrl: vi.fn(async () => null),
      summary: vi.fn(async () => ({ bytes: 0, files: 0 })),
      saveAssets: vi.fn(async () => undefined),
    };
    state.account = { accountKey: "test", store };
    state.fetchSet.mockResolvedValue({ set: { id: "set-1" }, sheets: state.sheets });
    state.fetchWorkspace.mockImplementation(async ({ sheetId }: { sheetId: string }) => ({ sheetId, metadata: {}, jobSheets: [] }));
    return store;
  }
  it("downloads from the set card without opening it, including originals and workspaces", async () => {
    const store = offlineStore();
    state.canManage = false;
    render(<JobDrawingsView jobId="job" />);
    fireEvent.click(screen.getByRole("button", { name: "Download Mechanical for offline use" }));
    await screen.findByText("Downloaded");
    expect(screen.getByRole("button", {name:"Mechanical downloaded"})).toBeDisabled();
    expect(state.fetchSet).toHaveBeenCalledWith({ setId: "set-1" });
    expect(store.saveAssets).toHaveBeenCalledWith(["/1.webp", "/2.webp", "/original.pdf"], expect.objectContaining({ budgetBytes: expect.any(Number) }));
    expect(store.saveSnapshot).toHaveBeenCalledWith("workspace:s2", expect.objectContaining({ sheetId: "s2" }));
    expect(store.saveSnapshot).toHaveBeenCalledWith("drawing-download:set-1", expect.objectContaining({ sheets: ["s1", "s2"] }));
    expect(screen.getByRole("button", { name: "Open Mechanical" })).toBeTruthy();
  });
  it("restores downloaded status only when the saved files and workspaces exist", async () => {
    const store = offlineStore();
    store.readSnapshot.mockImplementation(async (key: string) => key === "drawing-download:set-1" ? {
      version: `${state.sets[0]!.updatedAt.toISOString()}:2`, urls: ["/original.pdf"], sheets: ["s1", "s2"],
    } : {});
    store.readAsset.mockResolvedValue(new Blob(["PDF"]));
    const view = render(<JobDrawingsView jobId="job" />);
    await screen.findByText("Downloaded");
    expect(screen.getByRole("button", {name:"Mechanical downloaded"})).toBeDisabled();
    view.unmount();
    store.readAsset.mockResolvedValue(null);
    render(<JobDrawingsView jobId="job" />);
    await waitFor(() => expect(store.readAsset).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Downloaded")).toBeNull();
  });
  it("allows another download when the cloud folder version changes", async () => {
    const store = offlineStore();
    store.readSnapshot.mockImplementation(async (key: string) => key === "drawing-download:set-1" ? {
      version: `${new Date(0).toISOString()}:2`, urls: ["/original.pdf"], sheets: ["s1", "s2"],
    } : {});
    store.readAsset.mockResolvedValue(new Blob(["PDF"]));
    render(<JobDrawingsView jobId="job" />);
    await waitFor(() => expect(store.readSnapshot).toHaveBeenCalled());
    expect(screen.getByRole("button", {name:"Download Mechanical for offline use"})).toBeEnabled();
    expect(screen.queryByText("Downloaded")).toBeNull();
  });
  it("does not mark a failed download as complete", async () => {
    const store = offlineStore();
    store.saveAssets.mockRejectedValue(new Error("Device storage is full"));
    render(<JobDrawingsView jobId="job" />);
    fireEvent.click(screen.getByRole("button", { name: "Download Mechanical for offline use" }));
    await waitFor(() => expect(store.saveAssets).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Cancel download")).toBeNull());
    expect(screen.queryByText("Downloaded")).toBeNull();
    expect(store.saveSnapshot.mock.calls.some(call => call[0] === "drawing-download:set-1")).toBe(false);
  });
});

it("refocuses an already open drawing for every hyperlink, including repeated same-sheet destinations", () => {
  const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const jobId=id(1),setId=id(2);
  state.sets[0]!.id=setId;
  state.sheets[0]!.id=id(3);state.sheets[1]!.id=id(4);
  render(<JobDrawingsView jobId={jobId}/>);
  fireEvent.click(screen.getByRole("button",{name:"Open Mechanical"}));
  fireEvent.click(screen.getByRole("button",{name:"Open M-101"}));
  const jump=(sheetId:string,x:number)=>{
    const viewport={center:{x,y:.4},zoom:8};
    const saved=makeSnapshotSource(`/dashboard/jobs/${jobId}/drawings`,{version:1,drawing:{jobId,setId,sheetId,sourceSheetId:sheetId,viewport,appearance:{inverted:false,lineColor:null},layers:{markups:true,issues:true,private:true,published:true},selectedId:null}},"Tag");
    // Next navigation need not have changed location yet when the link is selected.
    act(()=>window.dispatchEvent(new CustomEvent(DRAWING_DESTINATION_EVENT,{detail:new URL(saved.href,location.origin).href})));
    expect(screen.getByTestId("mounted-view")).toHaveTextContent(JSON.stringify(viewport));
    return saved.href;
  };
  jump(id(3),.2);jump(id(3),.8);jump(id(3),.8);
  const other=jump(id(4),.6);
  expect(screen.getByText("Viewing M-102")).toBeVisible();
  act(()=>{window.history.replaceState(null,"",other);window.dispatchEvent(new PopStateEvent("popstate"));});
  expect(screen.getByTestId("mounted-view")).toHaveTextContent('"x":0.6');
});
