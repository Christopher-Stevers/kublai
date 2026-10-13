import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  screen: vi.fn(),
  needsScreen: vi.fn(),
  crop: vi.fn(),
  create: vi.fn(),
  send: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  push: vi.fn(),
  invalidate: vi.fn(),
  edit: vi.fn(),
  params: "",
  saved: null as null | {
    id: string;
    conversationId: string;
    revision: number;
    body: string;
    source: { href: string; title: string; capturedAt: string } | null;
    image: { id: string; name: string; mimeType: string; url: string };
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(mocks.params),
}));
vi.mock("~/lib/snapshot-capture", async (original) => ({
  ...(await original<object>()),
  captureVisiblePage: mocks.capture,
  captureSharedScreen: mocks.screen,
  needsScreenCapture: mocks.needsScreen,
  cropSnapshot: mocks.crop,
}));
vi.mock("~/lib/conversation-upload", () => ({
  uploadConversationFile: mocks.upload,
  removePendingConversationFile: mocks.remove,
}));
const people = [
  {
    id: "recipient",
    name: "Test recipient",
    email: "test@example.invalid",
    image: null,
  },
];
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      conversations: {
        list: { invalidate: mocks.invalidate },
        history: { invalidate: mocks.invalidate },
        savedSnapshots: { invalidate: mocks.invalidate },
      },
    }),
    conversations: {
      create: { useMutation: () => ({ mutateAsync: mocks.create }) },
      send: { useMutation: () => ({ mutateAsync: mocks.send }) },
      replaceSnapshot: { useMutation: () => ({ mutateAsync: mocks.edit }) },
      snapshot: { useQuery: () => ({ data: mocks.saved }) },
      savedSnapshots: {
        useQuery: () => ({ data: { snapshots: [], nextCursor: null } }),
      },
      people: { useQuery: () => ({ data: people }) },
      list: { useQuery: () => ({ data: { conversations: [] } }) },
    },
  },
}));
import { SnapshotProvider, useSnapshot } from "./SnapshotProvider";
function Launcher() {
  const snapshot = useSnapshot();
  return <button onClick={snapshot?.start}>Start snapshot</button>;
}
function setup() {
  render(
    <SnapshotProvider>
      <Launcher />
    </SnapshotProvider>,
  );
  fireEvent.click(screen.getByText("Start snapshot"));
}
beforeEach(() => {
  mocks.params = "";
  mocks.saved = null;
  window.history.replaceState({}, "", "/dashboard?filter=active");
  vi.clearAllMocks();
  mocks.needsScreen.mockReturnValue(false);
  mocks.capture.mockResolvedValue({
    toDataURL: () => "data:image/png;base64,a",
  });
  mocks.screen.mockResolvedValue({
    toDataURL: () => "data:image/png;base64,a",
  });
  mocks.crop.mockResolvedValue(
    new Blob(["cropped pixels"], { type: "image/png" }),
  );
  mocks.create.mockResolvedValue({ id: "private-conversation" });
  mocks.send.mockResolvedValue({ id: "sent" });
  mocks.edit.mockResolvedValue({ id: "saved-snapshot", revision: 2 });
  mocks.upload.mockResolvedValue({
    id: "file",
    name: "snapshot.png",
    url: "/private/file",
    mimeType: "image/png",
    size: 14,
  });
  mocks.remove.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:cropped"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
function editSetup() {
  mocks.params =
    "editSnapshot=saved-snapshot&snapshotChat=private-conversation";
  window.history.replaceState({}, "", `/dashboard?${mocks.params}`);
  mocks.saved = {
    id: "saved-snapshot",
    conversationId: "private-conversation",
    revision: 1,
    body: "Original caption",
    source: {
      href: "/dashboard#snapshot=original",
      title: "Saved drawing",
      capturedAt: "2026-10-09T22:00:00Z",
    },
    image: {
      id: "original-image",
      name: "snapshot.png",
      mimeType: "image/png",
      url: "/private/original",
    },
  };
  render(
    <SnapshotProvider>
      <Launcher />
    </SnapshotProvider>,
  );
}
it("opens directly in selection mode with compact capture controls", async () => {
  setup();
  await screen.findByAltText("Page ready for snapshot selection");
  expect(mocks.capture).toHaveBeenCalledOnce();
  expect(screen.queryByText("New snapshot")).toBeNull();
  expect(screen.queryByText("Drag a window around the area to share.")).toBeNull();
  expect(screen.getByRole("button", { name: "Saved snapshots" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Full screen snapshot" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Saved snapshots" }));
  expect(screen.getByLabelText("Search saved snapshots")).toBeVisible();
  expect(mocks.crop).not.toHaveBeenCalled();
});
it("accepts an area dragged while the page capture is preparing", async () => {
  let ready!: (canvas: { toDataURL: () => string }) => void;
  mocks.capture.mockReturnValue(new Promise(resolve => { ready = resolve; }));
  setup();
  const overlay = screen.getByRole("dialog", { name: "Select snapshot area" });
  overlay.setPointerCapture = vi.fn();
  fireEvent.pointerDown(overlay, { button: 0, clientX: 20, clientY: 30, pointerId: 1 });
  fireEvent.pointerUp(overlay, { button: 0, clientX: 220, clientY: 180, pointerId: 1 });
  expect(mocks.crop).not.toHaveBeenCalled();
  ready({ toDataURL: () => "data:image/png;base64,a" });
  await screen.findByAltText("Snapshot preview");
  expect(mocks.crop).toHaveBeenCalledWith(expect.anything(), { x: 20, y: 30, width: 200, height: 150 }, expect.anything());
});

it("opens the normal capture flow automatically and remakes a snapshot with fresh sharing options", async () => {
  mocks.edit.mockRejectedValueOnce(new Error("Connection interrupted"));
  editSetup();
  await screen.findByAltText("Page ready for snapshot selection");
  fireEvent.click(screen.getByRole("button", { name: "Full screen snapshot" }));
  expect(await screen.findByLabelText("Snapshot message")).toHaveValue("");
  expect(screen.queryByText("Keep image")).not.toBeInTheDocument();
  expect(screen.getByText("Send snapshot")).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Test recipient" }));
  fireEvent.change(screen.getByLabelText("Snapshot message"), {
    target: { value: "Corrected run" },
  });
  fireEvent.click(screen.getByText("Send snapshot"));
  await screen.findByText("Connection interrupted");
  expect(screen.getByLabelText("Snapshot message")).toBeDisabled();
  fireEvent.click(screen.getByText("Retry send"));
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      "/dashboard/chat?conversation=private-conversation",
    ),
  );
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.upload).toHaveBeenCalledOnce();
  expect(mocks.edit).toHaveBeenCalledTimes(2);
  expect(mocks.edit.mock.calls[0]).toEqual(mocks.edit.mock.calls[1]);
  const input = mocks.edit.mock.calls[0]?.[0] as { source: { href: string } };
  expect(input).toMatchObject({
    messageId: "saved-snapshot",
    expectedRevision: 1,
    attachmentId: "file",
    originalAttachmentId: "original-image",
    body: "Corrected run",
    targetConversationId: "private-conversation",
  });
  expect(input.source.href).not.toContain("editSnapshot");
  expect(input.source.href).not.toContain("snapshotChat");
});
it("waits for the saved drawing to load and allows cancellation without capturing a loading page", async () => {
  editSetup();
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const state = {
    version: 1,
    drawing: {
      jobId: id,
      sheetId: id,
      setId: id,
      sourceSheetId: id,
      viewport: { center: { x: 0.5, y: 0.5 }, zoom: 1 },
      appearance: { inverted: false, lineColor: null },
      layers: { markups: true, issues: true, private: true, published: true },
      selectedId: null,
    },
  };
  window.history.replaceState(
    {},
    "",
    `/dashboard?${mocks.params}#snapshot=${encodeURIComponent(JSON.stringify(state))}`,
  );
  await screen.findByText("Preparing snapshot…");
  expect(mocks.capture).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Cancel snapshot"));
  expect(mocks.edit).not.toHaveBeenCalled();
});
it("offers normal screen capture when the restored live editor loads after editing starts", async () => {
  mocks.needsScreen.mockReturnValueOnce(false).mockReturnValue(true);
  editSetup();
  fireEvent.click(await screen.findByText("Capture screen"));
  await screen.findByAltText("Page ready for snapshot selection");
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.screen).toHaveBeenCalledOnce();
});
it("keeps the original snapshot if recreating it is cancelled", async () => {
  editSetup();
  await screen.findByAltText("Page ready for snapshot selection");
  fireEvent.click(screen.getByLabelText("Cancel snapshot"));
  fireEvent.click(await screen.findByText("Cancel edit"));
  expect(mocks.push).toHaveBeenCalledWith(
    "/dashboard/chat?conversation=private-conversation",
  );
  expect(mocks.edit).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.capture).toHaveBeenCalledOnce();
});
it("keeps the fresh capture and sharing flow reachable in fullscreen and after the drawing closes", async () => {
  const drawing = document.createElement("div");
  drawing.dataset.drawingFullscreen = "true";
  document.body.append(drawing);
  try {
    editSetup();
    await screen.findByAltText("Page ready for snapshot selection");
    expect(
      drawing.contains(
        screen.getByRole("dialog", { name: "Select snapshot area" }),
      ),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Full screen snapshot" }));
    await screen.findByAltText("Snapshot preview");
    expect(drawing.contains(screen.getByAltText("Snapshot preview"))).toBe(
      true,
    );
    drawing.remove();
    await waitFor(() =>
      expect(
        document.body.contains(screen.getByAltText("Snapshot preview")),
      ).toBe(true),
    );
  } finally {
    drawing.remove();
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("retries the same snapshot, upload and message identity after an uncertain send", async () => {
  mocks.send.mockRejectedValueOnce(new Error("Connection interrupted"));
  setup();
  await screen.findByAltText("Page ready for snapshot selection");
  fireEvent.click(screen.getByRole("button", { name: "Full screen snapshot" }));
  await screen.findByAltText("Snapshot preview");
  fireEvent.click(screen.getByRole("checkbox", { name: "Test recipient" }));
  fireEvent.change(screen.getByLabelText("Snapshot message"), {
    target: { value: "Review this branch" },
  });
  fireEvent.click(screen.getByText("Send snapshot"));
  await screen.findByText("Connection interrupted");
  expect(screen.getByLabelText("Snapshot message")).toBeDisabled();
  fireEvent.click(screen.getByText("Retry send"));
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      "/dashboard/chat?conversation=private-conversation",
    ),
  );
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1]);
  expect(mocks.send.mock.calls[0]?.[0]).toMatchObject({
    body: "Review this branch",
    attachmentIds: ["file"],
    source: {
      href: expect.stringContaining(
        "/dashboard?filter=active#snapshot=",
      ) as string,
    },
  });
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("ignores a capture completing after the user cancels", async () => {
  let finish!: (value: { toDataURL: () => string }) => void;
  mocks.capture.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  setup();
  fireEvent.keyDown(window, { key: "Escape" });
  finish({ toDataURL: () => "data:image/png;base64,a" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("requests live editor capture only after an explicit screen capture click", async () => {
  mocks.needsScreen.mockReturnValue(true);
  setup();
  await screen.findByText(/choose this browser tab/);
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.screen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Capture screen"));
  await screen.findByAltText("Page ready for snapshot selection");
  expect(mocks.screen).toHaveBeenCalledTimes(1);
});
