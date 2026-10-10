import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: { conversations: { savedSnapshots: { useQuery: mocks.query } } },
}));
import { SavedSnapshotPicker } from "./SavedSnapshotPicker";
const snapshot = {
  id: "saved",
  conversationId: "chat",
  sequence: 40,
  body: "Check this pipe",
  source: {
    title: "M-302",
    href: "/dashboard?drawingSheet=sheet#snapshot=saved",
    capturedAt: "2026-10-09T22:00:00Z",
  },
  conversationName: "Site crew",
  imageUrl: "/api/chat/attachments/image",
  createdAt: new Date("2026-10-09T22:00:00Z"),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockReturnValue({
    data: { snapshots: [snapshot], nextCursor: 40 },
    refetch: mocks.refetch,
  });
});
afterEach(cleanup);
it("opens a saved view for editing directly from the snapshot picker", () => {
  const edit = vi.fn(),
    capture = vi.fn();
  render(<SavedSnapshotPicker onCapture={capture} onEdit={edit} />);
  fireEvent.click(screen.getByRole("button", { name: "My snapshots" }));
  fireEvent.click(screen.getByRole("button", { name: /M-302/ }));
  expect(edit).toHaveBeenCalledWith(
    "/dashboard?drawingSheet=sheet&editSnapshot=saved&snapshotChat=chat#snapshot=saved",
  );
  fireEvent.click(screen.getByText("New snapshot"));
  expect(capture).toHaveBeenCalledOnce();
});
it("searches with debounce and resets pagination for a different query", async () => {
  render(<SavedSnapshotPicker onCapture={vi.fn()} onEdit={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "My snapshots" }));
  fireEvent.click(screen.getByText("Older"));
  expect(mocks.query).toHaveBeenLastCalledWith(
    { search: "", beforeSequence: 40 },
    { enabled: true },
  );
  fireEvent.change(screen.getByLabelText("Search saved snapshots"), {
    target: { value: "  pipe  " },
  });
  expect(screen.getByText("Older")).toBeDisabled();
  await waitFor(() =>
    expect(mocks.query).toHaveBeenLastCalledWith(
      { search: "pipe", beforeSequence: undefined },
      { enabled: true },
    ),
  );
});
it("shows an empty library and still allows new captures", () => {
  mocks.query.mockReturnValue({ data: { snapshots: [], nextCursor: null } });
  render(<SavedSnapshotPicker onCapture={vi.fn()} onEdit={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "My snapshots" }));
  expect(
    screen.getByText("Snapshots you send in chat will appear here."),
  ).toBeVisible();
  expect(screen.getByText("New snapshot")).toBeEnabled();
});
it("shows load errors and retries without navigating away", () => {
  mocks.query.mockReturnValue({
    error: new Error("Connection lost"),
    refetch: mocks.refetch,
  });
  render(<SavedSnapshotPicker onCapture={vi.fn()} onEdit={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "My snapshots" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
  fireEvent.click(screen.getByText("Try again"));
  expect(mocks.refetch).toHaveBeenCalledOnce();
});
it("keeps saved snapshots folded away until the arrow is tapped", () => {
  mocks.query.mockClear();
  render(<SavedSnapshotPicker onCapture={vi.fn()} onEdit={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /M-302/ })).toBeNull();
  expect(screen.queryByLabelText("Search saved snapshots")).toBeNull();
  expect(mocks.query).toHaveBeenLastCalledWith(expect.anything(), { enabled: false });
  fireEvent.click(screen.getByRole("button", { name: "My snapshots" }));
  expect(screen.getByRole("button", { name: /M-302/ })).toBeVisible();
});
