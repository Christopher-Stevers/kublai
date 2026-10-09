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
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/dashboard",
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
      conversations: { list: { invalidate: mocks.invalidate } },
    }),
    conversations: {
      create: { useMutation: () => ({ mutateAsync: mocks.create }) },
      send: { useMutation: () => ({ mutateAsync: mocks.send }) },
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
