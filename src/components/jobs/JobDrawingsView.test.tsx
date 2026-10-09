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
  canManage: true,
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
        drawingsWorkspace: { list: { invalidate: state.refreshIdentities }, get: { invalidate: vi.fn() } },
        drawings: {
          listSets: { invalidate: vi.fn() },
          getSet: { invalidate: vi.fn() },
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
            data: { canManage: state.canManage, sets: state.sets },
          }),
        },
        getSet: {
          useQuery: (input: { setId: string }) => ({
            isLoading: false,
            data: input.setId
              ? {
                  canManage: state.canManage,
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
  DrawingWorkspace: ({ sheet, initialViewport, onViewportChange }: {
    sheet: { name: string };
    initialViewport?: { center: { x: number; y: number }; zoom: number } | null;
    onViewportChange?: (viewport: { center: { x: number; y: number }; zoom: number }) => void;
  }) => (
    <div>
      <span>Viewing {sheet.name}</span>
      <span data-testid="inherited-view">{JSON.stringify(initialViewport ?? null)}</span>
      <button onClick={() => onViewportChange?.({ center: { x: 0.2, y: 0.7 }, zoom: 3 })}>Zoom and pan sample</button>
    </div>
  ),
}));
vi.mock("./DrawingAccountProvider", () => ({ useDrawingAccount: () => null }));

import { JobDrawingsView } from "./JobDrawingsView";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  state.summaries = [];
  state.canManage = true;
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
      `/?drawingSet=${folder}&drawingSheet=${sheetId}`,
    );
    render(<JobDrawingsView jobId="job" />);
    expect(screen.getByText("Viewing M-101")).toBeInTheDocument();
  });
});
