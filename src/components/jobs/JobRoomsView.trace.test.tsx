import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  calls: [] as Array<{
    name: string;
    input: unknown;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>,
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
            useQuery: () => ({
              data: name === "getJobRooms" ? harness.data : undefined,
              isLoading: false,
            }),
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
vi.mock("~/lib/upload-drawings", () => ({ uploadDrawings: vi.fn() }));
vi.mock("~/components/ui/app-dialogs", () => ({ confirmAction: vi.fn() }));

import { JobRoomsView } from "./JobRoomsView";

const shape = { type: "bbox", x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
const nextShape = { ...shape, w: 0.6 };
const saved = { id: "room-added", name: "New room", updatedAt: new Date(2000) };
beforeEach(() => {
  harness.calls.length = 0;
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
    click("Back to rooms");
    openFloor("Floor B");
    click("Back to rooms");
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
