import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import { makeSnapshotSource, readSnapshotState } from "~/lib/snapshot-source";
import type { DrawingSave } from "~/lib/drawing-workspace";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  enqueue: vi.fn(),
  push: vi.fn(),
  patch: vi.fn(),
  capture: vi.fn(),
  online: true,
  ready: false,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: vi.fn() }));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => mocks.online,
}));
vi.mock("./DrawingAccountProvider", () => ({
  useDrawingAccount: () => ({
    userId: "current-user",
    accountKey: "org:current-user:simulation:session-id",
    store: { readSnapshot: async () => null },
  }),
}));
vi.mock("./useDrawingQueuedEdits", () => ({
  useDrawingQueuedEdits: () => ({ ready: mocks.ready, enqueue: mocks.enqueue }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ drawingsWorkspace: { get: { setData: mocks.patch } } }),
    drawingsWorkspace: {
      save: { useMutation: () => ({ mutateAsync: mocks.save }) },
    },
  },
}));
import {
  DrawingDestinationProvider,
  useDrawingDestination,
  type DestinationRequest,
} from "./DrawingDestinationProvider";
const sheetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request: DestinationRequest = {
  jobId: sheetId,
  authorName: "Test user",
  draft: {
    kind: "markup",
    sheetId,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    expectedRevision: 3,
    visibility: "private",
    data: {
      sourceSheetId: sheetId,
      type: "link",
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.2, y: 0.3 },
      ],
      stroke: "#facc15",
      width: 2,
      links: [{ label: "Manual", url: "https://example.com" }],
    },
  },
};
const origin = makeSnapshotSource(
  `/dashboard/jobs/${sheetId}/drawings`,
  { version: 1 },
  "Source sheet",
);
const destination = makeSnapshotSource(
  `/dashboard/jobs/${sheetId}/documents?folder=specs`,
  {
    version: 1,
    document: {
      jobId: sheetId,
      documentId: sheetId,
      versionId: null,
      tab: "versions",
      viewer: "preview",
    },
    pdf: { page: 5, zoom: 2.5, left: 0.25, top: 0.7 },
  },
  "Specification",
);
function Source() {
  const picker = useDrawingDestination();
  return (
    <button onClick={() => picker?.start(request)}>Choose destination</button>
  );
}
function Result() {
  const picker = useDrawingDestination();
  return <output data-testid="resume">{JSON.stringify(picker?.resume)}</output>;
}
function App({ browsing = false }: { browsing?: boolean }) {
  return (
    <SnapshotSourceContext.Provider
      value={{
        captureSource: mocks.capture,
        register: () => () => undefined,
        registerPage: () => () => undefined,
      }}
    >
      <DrawingDestinationProvider>
        {browsing ? <p>Document page</p> : <Source />}
        <Result />
      </DrawingDestinationProvider>
    </SnapshotSourceContext.Provider>
  );
}
const check = () =>
  screen.getByRole("button", { name: "Save current page as destination" });
beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
  mocks.online = true;
  mocks.ready = false;
  mocks.capture.mockReturnValueOnce(origin).mockReturnValue(destination);
  mocks.save.mockImplementation(async (input: DrawingSave) => ({
    id: input.id,
    sheetId: input.sheetId,
    kind: input.kind,
    data: input.data,
    revision: 4,
  }));
  mocks.enqueue.mockResolvedValue({});
});
afterEach(cleanup);
it("keeps the check mark after the source unmounts and appends the view captured when it is pressed", async () => {
  const view = render(<App />);
  fireEvent.click(screen.getByText("Choose destination"));
  view.rerender(<App browsing />);
  expect(check().textContent).toBe("");
  fireEvent.click(check());
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const input = mocks.save.mock.calls[0]![0] as Extract<
    DrawingSave,
    { kind: "markup" }
  >;
  expect(input.expectedRevision).toBe(3);
  expect(input.expectedUserId).toBe("current-user");
  expect(input.data.links).toHaveLength(2);
  expect(input.data.links![0]).toEqual(request.draft.data.links![0]);
  expect(input.data.links![1]).toEqual({
    label: "Specification",
    url: destination.href,
  });
  expect(
    readSnapshotState(
      new URL(input.data.links![1]!.url!, "https://app.invalid").hash,
    )?.pdf?.page,
  ).toBe(5);
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(origin.href, { scroll: false }),
  );
  expect(
    screen.queryByRole("button", { name: "Save current page as destination" }),
  ).toBeNull();
  expect(request.draft.data.links).toHaveLength(1);
});
it("retains the draft and captured view after a failure, and suppresses rapid duplicate saves", async () => {
  let reject!: (error: Error) => void;
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectSave) => {
        reject = rejectSave;
      }),
  );
  render(<App />);
  fireEvent.click(screen.getByText("Choose destination"));
  fireEvent.click(check());
  fireEvent.click(check());
  expect(mocks.save).toHaveBeenCalledOnce();
  reject(new Error("The drawing changed. Reload it before saving."));
  expect(await screen.findByRole("alert")).toHaveTextContent("drawing changed");
  expect(mocks.push).not.toHaveBeenCalled();
  mocks.capture.mockReturnValue(
    makeSnapshotSource("/dashboard/orders", { version: 1 }, "Different page"),
  );
  fireEvent.click(check());
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1]![0]).toEqual(mocks.save.mock.calls[0]![0]);
  expect(mocks.capture).toHaveBeenCalledTimes(2);
});
it("cancels without saving and returns the original draft", async () => {
  render(<App />);
  fireEvent.click(screen.getByText("Choose destination"));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.push).toHaveBeenCalledWith(origin.href, { scroll: false });
  const resume = JSON.parse(
    screen.getByTestId("resume").textContent ?? "null",
  ) as { draft: DrawingSave };
  expect(resume.draft).toEqual(request.draft);
});
it("uses the durable queue for a private destination when offline", async () => {
  mocks.online = false;
  mocks.ready = true;
  render(<App />);
  fireEvent.click(screen.getByText("Choose destination"));
  fireEvent.click(check());
  await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledOnce());
  expect(mocks.save).not.toHaveBeenCalled();
  const input = mocks.enqueue.mock.calls[0]![0] as Extract<
    DrawingSave,
    { kind: "markup" }
  >;
  expect(input.data.links?.[1]?.url).toBe(destination.href);
});
it("recovers an unfinished selection after a full page load", async () => {
  const view = render(<App />);
  fireEvent.click(screen.getByText("Choose destination"));
  view.unmount();
  render(<App browsing />);
  fireEvent.click(check());
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const input = mocks.save.mock.calls[0]![0] as Extract<
    DrawingSave,
    { kind: "markup" }
  >;
  expect(input.data.links?.[1]?.url).toBe(destination.href);
  expect(mocks.push).toHaveBeenCalledWith(origin.href, { scroll: false });
});
it("keeps the check mark inside an open modal so its focus trap can reach it", async () => {
  const view = render(<App />);
  fireEvent.click(screen.getByText("Choose destination"));
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("data-state", "open");
  document.body.append(dialog);
  await waitFor(() => expect(dialog.contains(check())).toBe(true));
  view.unmount();
  dialog.remove();
});
