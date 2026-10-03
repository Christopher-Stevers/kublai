import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomDetails, type RoomNotesDraft } from "./RoomDetails";
import { formatMaterialListDate } from "~/lib/material-list-names";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  create:
    vi.fn<
      (args: {
        materialListId: string;
        jobId: string;
        name: string;
      }) => Promise<void>
    >(),
  open: vi.fn(),
  invalidate: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      rooms: {
        getJobRooms: { invalidate: mocks.invalidate, fetch: mocks.fetch },
      },
    }),
    rooms: {
      updateNotes: {
        useMutation: () => ({ mutateAsync: mocks.save, isPending: false }),
      },
    },
  },
}));
vi.mock("~/lib/replicache-material-list", () => ({
  getMaterialListReplicache: () => ({
    mutate: { createMaterialList: mocks.create },
  }),
  mutateMaterialListAndSync: (promise: Promise<unknown>) => promise,
}));
function Harness({
  canEditNotes = true,
  canRequestMaterial = true,
  name = "Kitchen",
} = {}) {
  const [draft, setDraft] = useState<RoomNotesDraft>();
  return (
    <RoomDetails
      room={{ id: "room-a", name, notes: "Existing note", notesRevision: 3 }}
      jobId="job-a"
      draft={draft}
      onDraftChange={setDraft}
      canEditNotes={canEditNotes}
      canRequestMaterial={canRequestMaterial}
      onOpenMaterialList={mocks.open}
    />
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockImplementation(async ({ notes }: { notes: string }) => ({
    notes,
    notesRevision: 4,
  }));
  mocks.create.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("room notes and materials", () => {
  it("saves notes independently and shows the saved text", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Room notes"), {
      target: { value: "Valve behind ceiling" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Saved"),
    );
    expect(mocks.save).toHaveBeenCalledWith({
      roomId: "room-a",
      notes: "Valve behind ceiling",
      expectedNotesRevision: 3,
    });
    expect(screen.getByLabelText("Room notes")).toHaveValue(
      "Valve behind ceiling",
    );
  });

  it("preserves unsaved notes and does not navigate or create on save failure", async () => {
    mocks.save.mockRejectedValue(
      new Error("Someone else updated these notes."),
    );
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Room notes"), {
      target: { value: "My draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request material" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else");
    expect(screen.getByLabelText("Room notes")).toHaveValue("My draft");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("creates one dated list in the job and waits for local persistence before opening", async () => {
    let finish!: () => void;
    mocks.create.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Request material" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({
      materialListId: expect.any(String) as string,
      jobId: "job-a",
      name: `Kitchen — ${formatMaterialListDate()}`,
      roomId: "room-a",
      roomName: "Kitchen",
    });
    expect(mocks.open).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(mocks.open).toHaveBeenCalledWith(
      mocks.create.mock.calls[0]![0].materialListId,
    );
  });

  it("saves dirty notes before opening a request and keeps a long room title within the limit", async () => {
    render(<Harness name={"A".repeat(255)} />);
    fireEvent.change(screen.getByLabelText("Room notes"), {
      target: { value: "Need hangers" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request material" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalled());
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.create.mock.invocationCallOrder[0]!,
    );
    expect(mocks.create.mock.calls[0]![0].name).toHaveLength(255);
    expect(mocks.create.mock.calls[0]![0].name).toContain(
      formatMaterialListDate(),
    );
  });

  it("retains the room when creation fails and supports retry", async () => {
    mocks.create.mockRejectedValueOnce(new Error("Storage unavailable"));
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Request material" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Storage unavailable",
    );
    expect(mocks.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Request material" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalled());
    expect(mocks.create.mock.calls[1]![0].materialListId).toBe(
      mocks.create.mock.calls[0]![0].materialListId,
    );
  });

  it("lets a user review concurrent notes and explicitly keep their draft against the new revision", async () => {
    mocks.save.mockRejectedValueOnce(
      new Error("Notes changed. Review latest notes."),
    );
    mocks.fetch.mockResolvedValue({
      floors: [
        {
          rooms: [{ id: "room-a", notes: "Colleague note", notesRevision: 4 }],
        },
      ],
    });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Room notes"), {
      target: { value: "My draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Review latest saved notes" }),
    );
    expect(await screen.findByText("Colleague note")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep my draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Saved"),
    );
    expect(mocks.save).toHaveBeenLastCalledWith({
      roomId: "room-a",
      notes: "My draft",
      expectedNotesRevision: 4,
    });
  });

  it("does not open a request after leaving the room", async () => {
    let finish!: () => void;
    mocks.create.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Request material" }));
    unmount();
    await act(async () => finish());
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("honors view-only permissions", () => {
    render(<Harness canEditNotes={false} canRequestMaterial={false} />);
    expect(screen.getByLabelText("Room notes")).toHaveAttribute("readonly");
    expect(
      screen.queryByRole("button", { name: "Save notes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request material" }),
    ).not.toBeInTheDocument();
  });
});
