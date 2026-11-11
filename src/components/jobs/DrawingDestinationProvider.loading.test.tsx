import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
import type {
  DrawingDestinationProvider as ProviderComponent,
  useDrawingDestination as DestinationHook,
} from "./DrawingDestinationProvider";
import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import type {
  DestinationRequest,
  DestinationSession,
} from "./drawing-destination-session";

const mocks = vi.hoisted(() => ({
  account: "org:alice" as string | null,
  notify: vi.fn(),
  push: vi.fn(),
  parse: vi.fn<(raw: string) => DestinationSession | null>(),
  validatorLoads: vi.fn(),
  pickerLoads: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: mocks.notify }));
vi.mock("./DrawingAccountProvider", () => ({
  useDrawingAccount: () =>
    mocks.account
      ? { accountKey: mocks.account, userId: "alice", store: null }
      : null,
}));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request: DestinationRequest = {
  jobId: id,
  authorName: "Author",
  draft: {
    kind: "markup",
    sheetId: id,
    id,
    expectedRevision: 0,
    visibility: "private",
    data: {
      sourceSheetId: id,
      type: "link",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      stroke: "#facc15",
      width: 2,
    },
  },
};
const returnTo = {
  href: `/jobs/${id}/drawings`,
  title: "Original draft",
  capturedAt: "2026-01-01T00:00:00.000Z",
};
const restored = {
  phase: "resume",
  request: { ...request, returnTo, saved: false },
} as DestinationSession;
const key = "foremanhq:destination-picker:org:alice";
let useDestination: typeof DestinationHook;
let Provider: typeof ProviderComponent;
let latest: ReturnType<typeof useDestination> = null;
let validatorGate: Promise<void>;
let releaseValidator: () => void;
let rejectValidator: (error: Error) => void;
let saveGate: Promise<void>;
function Source() {
  const destination = useDestination();
  useEffect(() => {
    latest = destination;
  }, [destination]);
  return (
    <>
      <button onClick={() => destination?.start(request)}>
        Start destination
      </button>
      <output data-testid="restored">
        {JSON.stringify(destination?.resume)}
      </output>
    </>
  );
}
function Picker({ onFinish }: { onFinish: (saved: boolean) => void }) {
  return (
    <button
      onClick={() => {
        void saveGate.then(() => onFinish(true));
      }}
    >
      Finish destination
    </button>
  );
}
async function load() {
  ({
    DrawingDestinationProvider: Provider,
    useDrawingDestination: useDestination,
  } = await import("./DrawingDestinationProvider"));
}
function App() {
  return (
    <SnapshotSourceContext.Provider
      value={{
        captureSource: () => returnTo,
        register: () => () => undefined,
        registerPage: () => () => undefined,
      }}
    >
      <Provider>
        <Source />
      </Provider>
    </SnapshotSourceContext.Provider>
  );
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mocks.account = "org:alice";
  validatorGate = new Promise<void>((resolve, reject) => {
    releaseValidator = resolve;
    rejectValidator = reject;
  });
  saveGate = Promise.resolve();
  mocks.parse.mockReturnValue(restored);
  vi.doMock("~/components/chat/SnapshotSourceContext", () => ({
    SnapshotSourceContext,
  }));
  vi.doMock("./drawing-destination-session-validation", async () => {
    mocks.validatorLoads();
    await validatorGate;
    return { parseStoredDestinationSession: mocks.parse };
  });
  vi.doMock("./DrawingDestinationPicker", () => {
    mocks.pickerLoads();
    return { DestinationPicker: Picker };
  });
});
afterEach(() => {
  cleanup();
  vi.doUnmock("./drawing-destination-session-validation");
  vi.doUnmock("./DrawingDestinationPicker");
});
it("does not load picker or schema for an idle validated account", async () => {
  await load();
  render(<App />);
  expect(mocks.validatorLoads).not.toHaveBeenCalled();
  expect(mocks.pickerLoads).not.toHaveBeenCalled();
  expect(latest?.active).toBe(false);
});
it("does not read or restore an unbound account key", async () => {
  mocks.account = null;
  window.sessionStorage.setItem(
    "foremanhq:destination-picker:",
    "unbound draft",
  );
  const read = vi.spyOn(window.sessionStorage, "getItem");
  await load();
  render(<App />);
  fireEvent.click(screen.getByText("Start destination"));
  expect(read).not.toHaveBeenCalled();
  expect(mocks.validatorLoads).not.toHaveBeenCalled();
  expect(mocks.notify).toHaveBeenCalledWith(
    expect.stringContaining("workspace is still loading"),
    "error",
  );
  read.mockRestore();
});
it("blocks new starts with feedback and exposes restored data only after validation", async () => {
  window.sessionStorage.setItem(key, "bounded private draft");
  await load();
  render(<App />);
  fireEvent.click(screen.getByText("Start destination"));
  expect(mocks.notify).toHaveBeenCalledWith(
    expect.stringContaining("Restoring"),
    "error",
  );
  expect(latest?.resume).toBeNull();
  expect(mocks.pickerLoads).not.toHaveBeenCalled();
  await act(async () => {
    releaseValidator();
  });
  await waitFor(() =>
    expect(latest?.resume?.returnTo.title).toBe("Original draft"),
  );
});
it("does not expose malformed restored sessions", async () => {
  mocks.parse.mockReturnValue(null);
  window.sessionStorage.setItem(key, "malformed");
  await load();
  render(<App />);
  await act(async () => {
    releaseValidator();
  });
  await waitFor(() => expect(latest?.active).toBe(false));
  expect(latest?.resume).toBeNull();
  expect(mocks.pickerLoads).not.toHaveBeenCalled();
});
it("ignores delayed restore after account switch and preserves the old raw draft", async () => {
  window.sessionStorage.setItem(key, "old private draft");
  await load();
  const view = render(<App />);
  mocks.account = "org:bob";
  view.rerender(<App />);
  await act(async () => {
    releaseValidator();
  });
  expect(latest?.resume).toBeNull();
  expect(window.sessionStorage.getItem(key)).toBe("old private draft");
  expect(mocks.parse).not.toHaveBeenCalled();
});
it("keeps an active draft scoped to its account and ignores a late save callback after switch", async () => {
  let finish!: () => void;
  saveGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await load();
  const view = render(<App />);
  fireEvent.click(screen.getByText("Start destination"));
  fireEvent.click(await screen.findByText("Finish destination"));
  const raw = window.sessionStorage.getItem(key);
  mocks.account = "org:bob";
  view.rerender(<App />);
  expect(screen.queryByText("Finish destination")).not.toBeInTheDocument();
  await act(async () => {
    finish();
  });
  expect(mocks.push).not.toHaveBeenCalled();
  expect(latest?.resume).toBeNull();
  expect(window.sessionStorage.getItem(key)).toBe(raw);
});
it("retries a failed validator import without deleting the raw private draft", async () => {
  window.sessionStorage.setItem(key, "private draft retained");
  await load();
  render(<App />);
  await act(async () => {
    rejectValidator(new Error("Chunk unavailable"));
  });
  await screen.findByText("Retry saved destination");
  expect(window.sessionStorage.getItem(key)).toBe("private draft retained");
  vi.doMock("./drawing-destination-session-validation", () => ({
    parseStoredDestinationSession: mocks.parse,
  }));
  fireEvent.click(screen.getByText("Retry saved destination"));
  await waitFor(() =>
    expect(latest?.resume?.returnTo.title).toBe("Original draft"),
  );
  expect(window.sessionStorage.getItem(key)).toBe("private draft retained");
});
it("does not publish a delayed restore after unmount", async () => {
  window.sessionStorage.setItem(key, "private draft retained");
  await load();
  const view = render(<App />);
  view.unmount();
  await act(async () => {
    releaseValidator();
  });
  expect(mocks.parse).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(window.sessionStorage.getItem(key)).toBe("private draft retained");
});

it("keeps the controller and original draft while an active save survives a rerender", async () => {
  let finish!: () => void;
  saveGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await load();
  const view = render(<App />);
  fireEvent.click(screen.getByText("Start destination"));
  fireEvent.click(await screen.findByText("Finish destination"));
  const raw = window.sessionStorage.getItem(key);
  view.rerender(<App />);
  expect(latest?.active).toBe(true);
  expect(window.sessionStorage.getItem(key)).toBe(raw);
  await act(async () => {
    finish();
  });
  expect(mocks.push).toHaveBeenCalledWith(returnTo.href, { scroll: false });
  expect(latest?.resume?.draft).toEqual(request.draft);
});
it("retries picker import without discarding the active account draft", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.doUnmock("./DrawingDestinationPicker");
  await vi.dynamicImportSettled();
  vi.doMock("./DrawingDestinationPicker", () => {
    throw new Error("Chunk unavailable");
  });
  await load();
  render(<App />);
  fireEvent.click(screen.getByText("Start destination"));
  await screen.findByText("Try again");
  const raw = window.sessionStorage.getItem(key);
  expect(screen.queryByText("Reload app")).not.toBeInTheDocument();
  vi.doMock("./DrawingDestinationPicker", () => ({
    DestinationPicker: Picker,
  }));
  fireEvent.click(screen.getByText("Try again"));
  await screen.findByText("Finish destination");
  expect(window.sessionStorage.getItem(key)).toBe(raw);
  expect(latest?.active).toBe(true);
  error.mockRestore();
});

it("rejects a prior save callback even after the same account binds again", async () => {
  let finish!: () => void;
  saveGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await load();
  const view = render(<App />);
  fireEvent.click(screen.getByText("Start destination"));
  fireEvent.click(await screen.findByText("Finish destination"));
  mocks.account = "org:bob";
  view.rerender(<App />);
  mocks.account = "org:alice";
  view.rerender(<App />);
  mocks.parse.mockReturnValue({
    phase: "picking",
    request: { ...request, returnTo },
  });
  await act(async () => {
    releaseValidator();
  });
  await screen.findByText("Finish destination");
  await act(async () => {
    finish();
  });
  expect(mocks.push).not.toHaveBeenCalled();
  expect(latest?.resume).toBeNull();
  expect(latest?.active).toBe(true);
});
