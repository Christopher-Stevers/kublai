import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
}));
vi.mock("~/trpc/react", () => {
  const mutation = (name: string) => ({
    useMutation: (
      options: { onSuccess?: (result: unknown) => unknown } = {},
    ) => ({
      isPending: false,
      mutate: (input: unknown) => {
        state.calls.push([name, input]);
        void options.onSuccess?.({ id: "new-set" });
      },
    }),
  });
  return {
    api: {
      useUtils: () => ({
        drawingsWorkspace: { list: { invalidate: vi.fn() } },
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
  DrawingWorkspace: ({ sheet }: { sheet: { name: string } }) => (
    <div>Viewing {sheet.name}</div>
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
});
afterEach(cleanup);

describe("Drawings", () => {
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
    const file = new File(["%PDF-1"], "elec.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]')!;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(state.upload).toHaveBeenCalledWith("job", file, {
      drawingSetId: "new-set",
    });
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
    fireEvent.click(screen.getByRole("button", { name: "Show favorites" }));
    expect(screen.queryByRole("button", { name: "Open M-101" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
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
