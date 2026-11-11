import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrawingJobSheet } from "~/lib/drawing-workspace";
import { SuperLabelDialog } from "./SuperLabelDialog";

const server = vi.hoisted(() => ({ save: vi.fn(), apply: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: {
      superLabelSettings: {
        useQuery: () => ({
          data: {
            boxes: {
              title: { left: 0, top: 0, right: 0.4, bottom: 0.4 },
              number: { left: 0.5, top: 0.5, right: 1, bottom: 1 },
            },
            sheets: [
              { id: "first", name: "First sheet" },
              { id: "second", name: "Second sheet" },
            ],
          },
        }),
      },
      saveSuperLabelBoxes: {
        useMutation: () => ({ mutateAsync: server.save }),
      },
      applySuperLabel: { useMutation: () => ({ mutateAsync: server.apply }) },
    },
  },
}));

const source: DrawingJobSheet = {
  id: "first",
  sheetId: "first",
  setId: "set",
  name: "First sheet",
  imageUrl: "/synthetic.png",
  width: 100,
  height: 100,
  sourceFilename: null,
};
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const result = { title: "Read title", number: "M-101", warning: null };
const start = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Apply to 2 drawings in this set" }),
  );
beforeEach(() => {
  server.save.mockResolvedValue(undefined);
  server.apply.mockResolvedValue(result);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("shows each pending stage immediately and only displays labels returned by the server", async () => {
  const saving = deferred<void>();
  const reading = deferred<typeof result>();
  const refreshing = deferred<void>();
  server.save.mockReturnValue(saving.promise);
  server.apply.mockReturnValueOnce(reading.promise).mockResolvedValueOnce({
    ...result,
    title: "Second title",
    number: "M-102",
  });
  const onSaved = vi.fn(() => refreshing.promise);
  render(
    <SuperLabelDialog source={source} onClose={vi.fn()} onSaved={onSaved} />,
  );
  start();
  expect(screen.getByRole("status")).toHaveTextContent("Saving label boxes…");
  expect(server.apply).not.toHaveBeenCalled();
  await act(async () => saving.resolve());
  expect(screen.getByRole("status")).toHaveTextContent(
    "Reading 1 of 2: First sheet",
  );
  expect(screen.queryByText(/Read title/)).not.toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
  await act(async () => reading.resolve(result));
  expect(screen.getByText("Read title · M-101")).toBeInTheDocument();
  expect(screen.getByText("Second title · M-102")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Refreshing drawing labels…",
  );
  expect(
    screen.getByRole("button", { name: "Apply to 2 drawings in this set" }),
  ).toBeDisabled();
  await act(async () => refreshing.resolve());
  expect(screen.getByRole("status")).toHaveTextContent("2 / 2 processed");
  expect(screen.getByRole("status")).not.toHaveTextContent("Refreshing");
  expect(
    server.apply.mock.calls.map(
      ([input]) => (input as { targetId: string }).targetId,
    ),
  ).toEqual(["first", "second"]);
});

it("acknowledges Stop at once, finishes the in-flight read, and does not start another", async () => {
  const reading = deferred<typeof result>();
  server.apply.mockReturnValue(reading.promise);
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <SuperLabelDialog source={source} onClose={onClose} onSaved={onSaved} />,
  );
  start();
  await waitFor(() => expect(server.apply).toHaveBeenCalledOnce());
  fireEvent.click(
    screen.getByRole("button", { name: "Stop after current drawing" }),
  );
  expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Stopping after this drawing",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => reading.resolve(result));
  expect(server.apply).toHaveBeenCalledOnce();
  expect(onSaved).toHaveBeenCalledOnce();
  expect(screen.getByRole("status")).toHaveTextContent("1 / 2 processed");
});

it("stops before any read when requested while boxes are still saving", async () => {
  const saving = deferred<void>();
  server.save.mockReturnValue(saving.promise);
  render(
    <SuperLabelDialog source={source} onClose={vi.fn()} onSaved={vi.fn()} />,
  );
  start();
  fireEvent.click(screen.getByRole("button", { name: "Stop before reading" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "no drawings will be read",
  );
  await act(async () => saving.resolve());
  expect(server.apply).not.toHaveBeenCalled();
});

it("does not repeat a pending run, and a refused box save starts no reads", async () => {
  const saving = deferred<void>();
  server.save.mockReturnValue(saving.promise);
  const onSaved = vi.fn();
  render(
    <SuperLabelDialog source={source} onClose={vi.fn()} onSaved={onSaved} />,
  );
  act(() => {
    start();
    start();
  });
  expect(server.save).toHaveBeenCalledOnce();
  await act(async () => saving.reject(new Error("Permission changed")));
  expect(screen.getByRole("alert")).toHaveTextContent("Permission changed");
  expect(server.apply).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
});

it("reports an individual failed read without inventing a label and still processes the next sheet", async () => {
  server.apply.mockRejectedValueOnce(new Error("Image unavailable"));
  render(
    <SuperLabelDialog source={source} onClose={vi.fn()} onSaved={vi.fn()} />,
  );
  start();
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("2 / 2 processed"),
  );
  expect(
    screen.getByText("First sheet — Image unavailable"),
  ).toBeInTheDocument();
  expect(screen.getByText("Read title · M-101")).toBeInTheDocument();
  expect(server.apply).toHaveBeenCalledTimes(2);
});

it("refuses a new run offline without queuing a box save or model request", () => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  render(
    <SuperLabelDialog source={source} onClose={vi.fn()} onSaved={vi.fn()} />,
  );
  start();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Reconnect before applying labels",
  );
  expect(server.save).not.toHaveBeenCalled();
  expect(server.apply).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(server.save).not.toHaveBeenCalled();
});

it("retains the completed result but starts no further reads after losing the connection", async () => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const reading = deferred<typeof result>();
  server.apply.mockReturnValue(reading.promise);
  const onSaved = vi.fn();
  render(
    <SuperLabelDialog source={source} onClose={vi.fn()} onSaved={onSaved} />,
  );
  start();
  await waitFor(() => expect(server.apply).toHaveBeenCalledOnce());
  online.mockReturnValue(false);
  await act(async () => reading.resolve(result));
  expect(screen.getByText("Read title · M-101")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
  expect(server.apply).toHaveBeenCalledOnce();
  expect(onSaved).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(server.apply).toHaveBeenCalledOnce();
});
