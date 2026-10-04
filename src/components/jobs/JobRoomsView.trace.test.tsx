import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHeaderBackOverride } from "~/lib/header-back-events";

const harness = vi.hoisted(() => ({
  sandbox: false,
  data: {} as Record<string, unknown>,
  detectStatus: undefined as Record<string, unknown> | undefined,
  uploadSheets: [] as Array<{ id: string; name: string; imageUrl: string }>,
  queryOptions: {} as Record<string, { refetchInterval?: (query: { state: { data: unknown } }) => number | false }>,
  calls: [] as Array<{
    name: string;
    input: unknown;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({
  useTutorialSandbox: () => harness.sandbox ? { userId: "practice-user", runId: "run-one" } : null,
}));
vi.mock("~/trpc/react", async () => {
  const { useState } = await import("react");
  const query = {
    invalidate: async () => undefined,
    getData: () => harness.data,
  };
  type Callbacks = {
    onSuccess?: (value: unknown, input: unknown) => unknown;
    onError?: (error: Error, input: unknown) => unknown;
  };
  return {
    api: {
      useUtils: () => ({
        rooms: { getJobRooms: query, detectRoomsStatus: query },
      }),
      rooms: new Proxy(
        {},
        {
          get: (_target, name: string) => ({
            useQuery: (_input: unknown, options?: typeof harness.queryOptions[string]) => {
              if (options) harness.queryOptions[name] = options;
              return {
                data: name === "getJobRooms" ? harness.data : harness.detectStatus,
                isLoading: false,
              };
            },
            useMutation: (global: Callbacks = {}) => {
              const [isPending, setPending] = useState(false);
              const mutateAsync = async (input: unknown) => {
                setPending(true);
                try {
                  const value = await new Promise((resolve, reject) => {
                    harness.calls.push({ name, input, resolve, reject });
                  });
                  await global.onSuccess?.(value, input);
                  return value;
                } catch (error) {
                  await global.onError?.(error as Error, input);
                  throw error;
                } finally {
                  setPending(false);
                }
              };
              return {
                isPending,
                mutateAsync,
                mutate: (input: unknown, local: Callbacks = {}) => {
                  void mutateAsync(input).then(
                    (value) => local.onSuccess?.(value, input),
                    (error: Error) => local.onError?.(error, input),
                  );
                },
              };
            },
          }),
        },
      ),
    },
  };
});
vi.mock("~/components/jobs/FloorPlanCanvas", () => ({
  FloorPlanCanvas: (props: {
    onDetectAtPoint?: (point: { x: number; y: number }) => void;
    onSelectRoom: (id: string) => void;
    previewShape: unknown;
  }) => (
    <div>
      <button onClick={() => props.onSelectRoom("room-a")}>
        Select existing room
      </button>
      {props.onDetectAtPoint ? (
        <button onClick={() => props.onDetectAtPoint?.({ x: 0.2, y: 0.2 })}>
          Tap trace seed
        </button>
      ) : null}
      <output data-testid="trace-preview">
        {JSON.stringify(props.previewShape)}
      </output>
    </div>
  ),
}));
vi.mock("~/lib/upload-drawings", () => ({ uploadDrawings: vi.fn(async () => harness.uploadSheets) }));
vi.mock("~/components/ui/app-dialogs", () => ({ confirmAction: vi.fn() }));

import { JobRoomsView } from "./JobRoomsView";

const shape = { type: "bbox", x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
const nextShape = { ...shape, w: 0.6 };
const saved = { id: "room-added", name: "New room", updatedAt: new Date(2000) };
beforeEach(() => {
  harness.sandbox = false;
  harness.calls.length = 0;
  harness.detectStatus = undefined;
  harness.uploadSheets = [];
  harness.queryOptions = {};
  harness.data = {
    canManage: true,
    plan: null,
    floors: ["a", "b"].map((id) => ({
      id: `floor-${id}`,
      name: `Floor ${id.toUpperCase()}`,
      imageUrl: `/floor-${id}.webp`,
      status: "detected",
      updatedAt: new Date(1000),
      completenessReviewedAt: null,
      rooms: [
        {
          id: `room-${id}`,
          name: `Room ${id.toUpperCase()}`,
          shape,
          updatedAt: new Date(1000),
          reviewStatus: "pending",
          confirmed: false,
          detection: {},
        },
      ],
    })),
  };
});
afterEach(cleanup);

const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
// The app bar back arrow leaves the floor plan (there is no separate button).
const leaveFloor = () => act(() => void runHeaderBackOverride());
function openFloor(name = "Floor A") {
  fireEvent.click(screen.getByText(name, { exact: true }));
  click("Edit");
}
async function resolveLatestTrace(value = shape) {
  const call = harness.calls.filter((call) => call.name === "growRoom").at(-1)!;
  await act(async () => {
    call.resolve({ shape: value });
  });
}
async function startNewTrace(value = shape) {
  click("Trace room");
  click("Tap trace seed");
  await resolveLatestTrace(value);
}

describe("trace saves belong to their original editing session", () => {
  it("does not cancel or focus over a new trace when a cancelled save succeeds", async () => {
    render(<JobRoomsView jobId="job-a" />);
    openFloor();
    await startNewTrace();
    click("Save trace");
    const saving = harness.calls.find((call) => call.name === "addRoom")!;
    click("Cancel");
    await startNewTrace(nextShape);
    await act(async () => {
      saving.resolve(saved);
    });
    expect(screen.getByRole("button", { name: "Save trace" })).toBeEnabled();
    expect(screen.getByTestId("trace-preview")).toHaveTextContent(
      JSON.stringify(nextShape),
    );
    expect(screen.queryByRole("button", { name: "Auto trace" })).toBeNull();
  });

  it("does not restore save effects after leaving a floor and coming back", async () => {
    render(<JobRoomsView jobId="job-a" />);
    openFloor();
    await startNewTrace();
    click("Save trace");
    const saving = harness.calls.find((call) => call.name === "addRoom")!;
    leaveFloor();
    openFloor("Floor B");
    leaveFloor();
    openFloor();
    await startNewTrace();
    await act(async () => {
      saving.resolve(saved);
    });
    expect(screen.getByRole("button", { name: "Save trace" })).toBeEnabled();
    expect(screen.getByTestId("trace-preview")).toHaveTextContent(
      JSON.stringify(shape),
    );
    expect(screen.queryByRole("button", { name: "Auto trace" })).toBeNull();
  });

  it("does not clear a new trace after an earlier edited-room save finishes", async () => {
    render(<JobRoomsView jobId="job-a" />);
    openFloor();
    click("Select existing room");
    click("Auto trace");
    await resolveLatestTrace();
    click("Save trace");
    const saving = harness.calls.find((call) => call.name === "updateRoom")!;
    click("Cancel");
    await startNewTrace();
    const floors = harness.data.floors as Array<{
      rooms: Array<{ updatedAt: Date }>;
    }>;
    floors[0]!.rooms[0]!.updatedAt = new Date(2000);
    await act(async () => {
      saving.resolve({ ok: true, updatedAt: 2000 });
    });
    expect(screen.getByRole("button", { name: "Save trace" })).toBeEnabled();
    expect(screen.getByTestId("trace-preview")).toHaveTextContent(
      JSON.stringify(shape),
    );
  });

  it("still finishes and focuses a successfully saved current trace", async () => {
    render(<JobRoomsView jobId="job-a" />);
    openFloor();
    await startNewTrace();
    click("Save trace");
    const saving = harness.calls.find((call) => call.name === "addRoom")!;
    await act(async () => {
      saving.resolve(saved);
    });
    expect(screen.queryByRole("button", { name: "Save trace" })).toBeNull();
    expect(screen.getByRole("button", { name: "Auto trace" })).toBeEnabled();
    expect(screen.getByTestId("trace-preview")).toHaveTextContent("null");
  });
});

describe("floor plan bottom bar", () => {
  it("opens the real room controls in practice without upload or detection tools", () => {
    harness.sandbox = true;
    render(<JobRoomsView jobId="job-a" />);
    expect(screen.queryByRole("button", { name: /Upload drawings/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete floor/ })).toBeNull();
    fireEvent.click(document.querySelector('[data-tutorial="floor-card"]')!);
    expect(document.querySelector('[data-tutorial="drawing-viewer"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    fireEvent.click(document.querySelector('[data-tutorial="room-list-toggle"]')!);
    fireEvent.click(document.querySelector('[data-tutorial="room-list-item"]')!);
    expect(document.querySelector('[data-tutorial="room-details"]')).toBeInTheDocument();
    expect(document.querySelector('[data-tutorial="room-notes"]')).toBeInTheDocument();
    expect(harness.calls).toEqual([]);
  });

  it("keeps review and confirm in the edit menu and pops up the room list", () => {
    render(<JobRoomsView jobId="job-a" />);
    fireEvent.click(screen.getByText("Floor A", { exact: true }));

    // Only the drawing and the bar until a menu is opened.
    expect(screen.queryByRole("button", { name: /Review detections/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm reviewed floor" })).toBeNull();
    expect(screen.queryByLabelText("Room list")).toBeNull();

    click("Rooms (1)");
    expect(screen.getByLabelText("Room list")).toHaveTextContent("Room A");
    // Picking a room opens it; the back arrow returns to the plan with the popup closed.
    fireEvent.click(screen.getByRole("button", { name: "Room A" }));
    expect(screen.getByText("Room notes")).toBeInTheDocument();
    leaveFloor();
    expect(screen.getByRole("button", { name: "Rooms (1)" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Room list")).toBeNull();

    click("Edit");
    const menu = screen.getByLabelText("Edit menu");
    expect(menu).toContainElement(screen.getByRole("button", { name: /Review detections \(1\)/ }));
    expect(menu).toContainElement(screen.getByRole("button", { name: "Confirm reviewed floor" }));

    // Switching to review and back keeps the menu open; Done closes it.
    click("Review detections (1)");
    expect(screen.getByLabelText("Detection review")).toBeInTheDocument();
    click("Review detections (1)");
    expect(screen.getByLabelText("Edit menu")).toBeInTheDocument();
    click("Done");
    expect(screen.queryByLabelText("Edit menu")).toBeNull();
  });
});

describe("floor card menu", () => {
  it("replaces the trash can with a menu to copy or delete the floor", async () => {
    render(<JobRoomsView jobId="job-a" />);
    expect(screen.queryByRole("button", { name: /^Delete floor/ })).toBeNull();
    const trigger = screen.getByRole("button", { name: "More actions for Floor A" });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy floor" }));
    expect(harness.calls.at(-1)).toMatchObject({
      name: "copyFloor",
      input: { floorId: "floor-a" },
    });
    // Opening the menu does not open the floor.
    expect(screen.queryByRole("button", { name: /^Rooms \(/ })).toBeNull();

    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete floor" }));
    expect(await screen.findByText("Delete floor?")).toBeInTheDocument();
  });
});

describe("floor name box", () => {
  const renames = () => harness.calls.filter((call) => call.name === "renameFloor");
  function openNameBox() {
    render(<JobRoomsView jobId="job-a" />);
    fireEvent.click(screen.getByText("Floor A", { exact: true }));
    click("Edit");
    return screen.getByLabelText("Floor name") as HTMLInputElement;
  }

  it("does not save or reset the box while typing, then saves once when editing ends", async () => {
    const box = openNameBox();
    expect(box.value).toBe("Floor A");
    vi.useFakeTimers();
    try {
      // Clearing the box to retype must not snap the old name back.
      for (const value of ["", "1", "1st", "1st F", "1st Floor"]) {
        fireEvent.change(box, { target: { value } });
        act(() => vi.advanceTimersByTime(2000));
        expect(box.value).toBe(value);
      }
    } finally {
      vi.useRealTimers();
    }
    expect(renames()).toHaveLength(0);
    fireEvent.blur(box);
    // Done also saves; the same name is only sent once.
    click("Done");
    expect(renames()).toHaveLength(1);
    expect(renames()[0]!.input).toEqual({ floorId: "floor-a", name: "1st Floor" });
  });

  it("puts the name back when left blank, and Return finishes editing", () => {
    const box = openNameBox();
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.blur(box);
    expect(box.value).toBe("Floor A");
    expect(renames()).toHaveLength(0);

    box.focus();
    fireEvent.change(box, { target: { value: "Level 3" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(document.activeElement).not.toBe(box);
    expect(renames().at(-1)?.input).toEqual({ floorId: "floor-a", name: "Level 3" });
  });
});

describe("server-managed sheet detection queue", () => {
  function setFloorDetection(index: number, detection: Record<string, unknown>) {
    const floors = harness.data.floors as Array<Record<string, unknown>>;
    floors[index]!.detection = detection;
  }

  it("confirms a multi-sheet upload once without launching detection from the browser", async () => {
    harness.uploadSheets = ["a", "b"].map((id) => ({ id: `floor-${id}`, name: `Sheet ${id.toUpperCase()}`, imageUrl: `/floor-${id}.webp` }));
    render(<JobRoomsView jobId="job-a" />);
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["pdf"], "drawings.pdf", { type: "application/pdf" })] },
    });
    expect(await screen.findByText("Review uploaded drawings")).toBeInTheDocument();
    click("Confirm sheets");
    const confirmation = harness.calls.find((call) => call.name === "confirmDrawingUpload")!;
    expect(confirmation.input).toEqual({ jobId: "job-a", keepFloorIds: ["floor-a", "floor-b"] });
    setFloorDetection(0, { status: "queued", queuePosition: 1 });
    setFloorDetection(1, { status: "queued", queuePosition: 2 });
    await act(async () => { confirmation.resolve({ keptFloorIds: ["floor-a", "floor-b"] }); });
    expect(harness.calls.filter((call) => call.name === "detectRooms")).toEqual([]);
    expect(screen.getByRole("button", { name: "Queued…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New room" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Trace room" })).toBeDisabled();
  });

  it("shows overview progress and each sheet's queue position without calling queued sheets failures", () => {
    setFloorDetection(0, { status: "running" });
    setFloorDetection(1, { status: "queued", queuePosition: 3 });
    render(<JobRoomsView jobId="job-a" />);
    expect(screen.getByRole("status", { name: "Room detection queue" })).toHaveTextContent("1 processing · 1 queued");
    expect(screen.getByText("Queued · position 3")).toBeInTheDocument();
    expect(screen.getByText("Detecting rooms…")).toBeInTheDocument();
    const poll = harness.queryOptions.getJobRooms!.refetchInterval!;
    expect(poll({ state: { data: harness.data } })).toBe(5000);
    expect(poll({ state: { data: { floors: [{ detection: { status: "done" } }] } } })).toBe(false);
  });

  it("keeps a queued sheet busy even while the detail query contains an old completed run", () => {
    setFloorDetection(0, { status: "queued", queuePosition: 2 });
    harness.detectStatus = { floorId: "floor-a", status: "done", startedAt: 1000, log: [{ at: 1000, message: "Old run complete" }] };
    render(<JobRoomsView jobId="job-a" />);
    openFloor();
    expect(screen.getByRole("button", { name: "Queued…" })).toBeDisabled();
    expect(screen.queryByText("Old run complete")).not.toBeInTheDocument();
    expect(screen.getByText(/Queued · position 2 · You can leave/)).toBeInTheDocument();
    const poll = harness.queryOptions.detectRoomsStatus!.refetchInterval!;
    expect(poll({ state: { data: { status: "queued" } } })).toBe(1000);
  });

  it("reports a failed sheet separately and allows retrying just that sheet", () => {
    setFloorDetection(0, { status: "error", error: "Worker stopped" });
    setFloorDetection(1, { status: "done" });
    render(<JobRoomsView jobId="job-a" />);
    expect(screen.getByRole("status", { name: "Room detection queue" })).toHaveTextContent("0 processing · 0 queued · 1 failed");
    const failedCard = screen.getByText("Floor A").closest('[data-tutorial="floor-card"]')!;
    expect(within(failedCard as HTMLElement).getByText("Detection failed: Worker stopped")).toBeInTheDocument();
    openFloor();
    click("Detect rooms");
    expect(harness.calls.filter((call) => call.name === "detectRooms")).toEqual([expect.objectContaining({ input: { floorId: "floor-a", method: "complete" } })]);
  });
});
