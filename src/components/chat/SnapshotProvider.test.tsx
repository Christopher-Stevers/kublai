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
      },
    }),
    conversations: {
      create: { useMutation: () => ({ mutateAsync: mocks.create }) },
      send: { useMutation: () => ({ mutateAsync: mocks.send }) },
      editSnapshot: { useMutation: () => ({ mutateAsync: mocks.edit }) },
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
  fireEvent.click(screen.getByText("New snapshot"));
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
it("opens the snapshot tool choices before taking a new capture", () => {
  render(
    <SnapshotProvider>
      <Launcher />
    </SnapshotProvider>,
  );
  fireEvent.click(screen.getByText("Start snapshot"));
  expect(screen.getByText("Edit a saved snapshot")).toBeVisible();
  expect(screen.getByText("New snapshot")).toBeVisible();
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(
    document.querySelector('[data-slot="dialog-overlay"]'),
  ).toHaveAttribute("data-snapshot-ui");
});
it("retakes an existing snapshot, preserves its caption and retries one replacement", async () => {
  mocks.edit.mockRejectedValueOnce(new Error("Connection interrupted"));
  editSetup();
  fireEvent.click(await screen.findByText("Retake snapshot"));
  await screen.findByAltText("Page ready for snapshot selection");
  fireEvent.click(screen.getByText("Whole view"));
  expect(await screen.findByLabelText("Snapshot message")).toHaveValue(
    "Original caption",
  );
  fireEvent.change(screen.getByLabelText("Snapshot message"), {
    target: { value: "Corrected run" },
  });
  fireEvent.click(screen.getByText("Save changes"));
  await screen.findByText("Connection interrupted");
  expect(screen.getByLabelText("Snapshot message")).toBeDisabled();
  fireEvent.click(screen.getByText("Retry save"));
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      "/dashboard/chat?conversation=private-conversation",
    ),
  );
  expect(mocks.create).not.toHaveBeenCalled();
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
  });
  expect(input.source.href).not.toContain("editSnapshot");
  expect(input.source.href).not.toContain("snapshotChat");
});
it("updates a caption while keeping the existing image and saved source", async () => {
  editSetup();
  fireEvent.click(await screen.findByText("Keep image"));
  expect(await screen.findByAltText("Snapshot preview")).toHaveAttribute(
    "src",
    "/private/original",
  );
  fireEvent.change(screen.getByLabelText("Snapshot message"), {
    target: { value: "New caption" },
  });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(mocks.edit).toHaveBeenCalledOnce());
  expect(mocks.edit.mock.calls[0]?.[0]).toMatchObject({
    attachmentId: "original-image",
    body: "New caption",
    source: mocks.saved?.source,
  });
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("cancels without replacing the saved snapshot", async () => {
  editSetup();
  fireEvent.click(await screen.findByText("Cancel edit"));
  expect(mocks.push).toHaveBeenCalledWith(
    "/dashboard/chat?conversation=private-conversation",
  );
  expect(mocks.edit).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("keeps edit controls and dialogs reachable in fullscreen and after the drawing closes", async () => {
  const drawing = document.createElement("div");
  drawing.dataset.drawingFullscreen = "true";
  document.body.append(drawing);
  try {
    editSetup();
    await waitFor(() =>
      expect(
        drawing.contains(screen.getByLabelText("Edit saved snapshot")),
      ).toBe(true),
    );
    fireEvent.click(screen.getByText("Keep image"));
    await waitFor(() =>
      expect(drawing.contains(screen.getByAltText("Snapshot preview"))).toBe(
        true,
      ),
    );
    fireEvent.click(screen.getByText("Retake"));
    drawing.remove();
    await waitFor(() =>
      expect(
        document.body.contains(screen.getByLabelText("Edit saved snapshot")),
      ).toBe(true),
    );
    expect(drawing.contains(screen.getByLabelText("Edit saved snapshot"))).toBe(
      false,
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
  fireEvent.click(screen.getByText("Whole view"));
  await screen.findByAltText("Snapshot preview");
  fireEvent.click(screen.getByRole("radio", { name: "Test recipient" }));
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
