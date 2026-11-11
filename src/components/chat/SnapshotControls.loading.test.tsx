import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as SnapshotControlsModule from "./SnapshotControls";
import type { SnapshotControlsProps } from "./SnapshotControls";
const state = vi.hoisted(() => ({
  capture: vi.fn(),
  screen: vi.fn(),
  crop: vi.fn(),
  needsScreen: vi.fn(),
  mounted: vi.fn(),
  send: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/jobs",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: state.push }),
}));
vi.mock("~/lib/snapshot-capture", async (original) => ({
  ...(await original<object>()),
  captureVisiblePage: state.capture,
  captureSharedScreen: state.screen,
  cropSnapshot: state.crop,
  needsScreenCapture: state.needsScreen,
}));
vi.mock("~/lib/conversation-upload", () => ({
  uploadConversationFile: vi.fn(),
  removePendingConversationFile: vi.fn(async () => undefined),
}));
vi.mock("./RecipientChooser", () => ({ RecipientChooser: () => null }));
vi.mock("./SavedSnapshotPicker", () => ({ SavedSnapshotPicker: () => null }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      conversations: {
        list: { invalidate: vi.fn(async () => undefined) },
        history: { invalidate: vi.fn(async () => undefined) },
        savedSnapshots: { invalidate: vi.fn(async () => undefined) },
      },
    }),
    conversations: {
      snapshot: { useQuery: () => ({ data: undefined, error: null }) },
      savedSnapshots: {
        useQuery: () => ({ data: { snapshots: [], nextCursor: null } }),
      },
      people: { useQuery: () => ({ data: [] }) },
      list: { useQuery: () => ({ data: { conversations: [] } }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      send: { useMutation: () => ({ mutateAsync: state.send }) },
      replaceSnapshot: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function Editor(props: SnapshotControlsProps) {
  const [local, setLocal] = useState("");
  state.mounted();
  return (
    <>
      <input
        aria-label="Snapshot message"
        value={props.message}
        onChange={(event) => props.setMessage(event.target.value)}
      />
      <input
        aria-label="Local controls draft"
        value={local}
        onChange={(event) => setLocal(event.target.value)}
      />
      <output aria-label="Retained preview">{props.preview}</output>
      <button onClick={props.screenCapture}>Capture screen</button>
      <button onClick={props.retake}>Retake</button>
      <button onClick={props.release}>Close editor</button>
    </>
  );
}
async function mount() {
  const { SnapshotProvider, useSnapshot } = await import("./SnapshotProvider");
  function Launcher() {
    return <button onClick={useSnapshot()?.start}>Start snapshot</button>;
  }
  const tree = (binding = "initial") => (
    <SnapshotProvider key={binding}>
      <input aria-label="Parent draft" defaultValue="" />
      <Launcher />
    </SnapshotProvider>
  );
  return { ...render(tree()), tree };
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/jobs");
  state.needsScreen.mockReturnValue(false);
  state.capture.mockResolvedValue({
    toDataURL: () => "data:image/png;base64,a",
  });
  state.screen.mockResolvedValue({
    toDataURL: () => "data:image/png;base64,b",
  });
  state.crop.mockResolvedValue(
    new Blob(["private crop"], { type: "image/png" }),
  );
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:retained-capture"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.doUnmock("./SnapshotControls");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("never imports controls while idle, and Close while loading fences late presentation", async () => {
  state.needsScreen.mockReturnValue(true);
  const gate = deferred<{ SnapshotControls: typeof Editor }>(),
    load = vi.fn(() => gate.promise);
  vi.doMock("./SnapshotControls", load);
  await mount();
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Start snapshot"));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Opening snapshot controls",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close snapshot" }));
  await act(async () => gate.resolve({ SnapshotControls: Editor }));
  expect(state.mounted).not.toHaveBeenCalled();
  expect(state.screen).not.toHaveBeenCalled();
  expect(state.send).not.toHaveBeenCalled();
});
it("delayed screen controls still invoke capture synchronously from the real click", async () => {
  state.needsScreen.mockReturnValue(true);
  const gate = deferred<{ SnapshotControls: typeof Editor }>();
  vi.doMock("./SnapshotControls", () => gate.promise);
  await mount();
  fireEvent.click(screen.getByText("Start snapshot"));
  expect(state.screen).not.toHaveBeenCalled();
  await act(async () => gate.resolve({ SnapshotControls: Editor }));
  const order: string[] = [];
  state.screen.mockImplementation(() => {
    order.push("capture");
    return Promise.resolve({ toDataURL: () => "data:image/png;base64,b" });
  });
  fireEvent.click(screen.getByRole("button", { name: "Capture screen" }));
  order.push("click returned");
  expect(order).toEqual(["capture", "click returned"]);
});
it("import Retry retains captured image and parent draft; mounted controls remain the same through rerenders", async () => {
  vi.doMock("./SnapshotControls", () => Promise.reject(Error("missing chunk")));
  const view = await mount();
  const parent = screen.getByLabelText("Parent draft");
  fireEvent.change(parent, { target: { value: "Unsent parent work" } });
  fireEvent.click(screen.getByText("Start snapshot"));
  await screen.findByAltText("Page ready for snapshot selection");
  fireEvent.click(screen.getByRole("button", { name: "Full screen snapshot" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Snapshot controls could not load",
  );
  expect(state.crop).toHaveBeenCalledOnce();
  vi.doMock("./SnapshotControls", () => ({ SnapshotControls: Editor }));
  vi.resetModules();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  const caption = await screen.findByLabelText("Snapshot message");
  expect(screen.getByLabelText("Retained preview")).toHaveTextContent(
    "blob:retained-capture",
  );
  fireEvent.change(caption, { target: { value: "Keep this caption" } });
  const local = screen.getByLabelText("Local controls draft");
  fireEvent.change(local, { target: { value: "Keep local state" } });
  caption.focus();
  view.rerender(view.tree());
  expect(screen.getByLabelText("Snapshot message")).toBe(caption);
  expect(caption).toHaveFocus();
  expect(caption).toHaveValue("Keep this caption");
  expect(local).toHaveValue("Keep local state");
  expect(parent).toHaveValue("Unsent parent work");
  expect(state.capture).toHaveBeenCalledOnce();
  expect(state.crop).toHaveBeenCalledOnce();
  expect(state.send).not.toHaveBeenCalled();
});

it.each(["unmount", "key replacement"])(
  "late deferred controls after %s cannot restore old capture or message",
  async (mode) => {
    const { SnapshotControls: Actual } =
      await vi.importActual<typeof SnapshotControlsModule>(
        "./SnapshotControls",
      );
    vi.doMock("./SnapshotControls", () => ({ SnapshotControls: Actual }));
    const view = await mount();
    fireEvent.click(screen.getByText("Start snapshot"));
    await screen.findByAltText("Page ready for snapshot selection");
    fireEvent.click(
      screen.getByRole("button", { name: "Full screen snapshot" }),
    );
    const oldCaption = await screen.findByLabelText("Snapshot message");
    fireEvent.change(oldCaption, { target: { value: "Old private caption" } });
    fireEvent.click(screen.getByRole("button", { name: "Retake" }));
    await screen.findByAltText("Page ready for snapshot selection");
    const gate = deferred<{ SnapshotControls: typeof Actual }>();
    vi.doMock("./SnapshotControls", () => gate.promise);
    vi.resetModules();
    fireEvent.click(
      screen.getByRole("button", { name: "Full screen snapshot" }),
    );
    await screen.findByLabelText("Opening snapshot controls");
    if (mode === "unmount") {
      view.unmount();
      await mount();
    } else view.rerender(view.tree("replacement"));
    state.needsScreen.mockReturnValue(true);
    fireEvent.click(screen.getByText("Start snapshot"));
    await act(async () => gate.resolve({ SnapshotControls: Actual }));
    await screen.findByRole("button", { name: "Capture screen" });
    expect(screen.queryByLabelText("Snapshot message")).toBeNull();
    expect(screen.queryByAltText("Snapshot preview")).toBeNull();
    expect(screen.queryByDisplayValue("Old private caption")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Capture screen" }));
    await screen.findByAltText("Page ready for snapshot selection");
    fireEvent.click(
      screen.getByRole("button", { name: "Full screen snapshot" }),
    );
    expect(await screen.findByLabelText("Snapshot message")).toHaveValue("");
    expect(state.send).not.toHaveBeenCalled();
  },
);
