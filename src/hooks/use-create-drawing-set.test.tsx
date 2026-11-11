import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity, StrictMode, useState, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCreateDrawingSet } from "./use-create-drawing-set";
const state = vi.hoisted(() => ({
  create: vi.fn(),
  sets: vi.fn(),
  summaries: vi.fn(),
  parent: vi.fn(),
  notify: vi.fn(),
  account: { accountKey: "org:actor", userId: "actor" },
  authority: {} as object,
}));
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({
  useDrawingAccount: () => state.account,
}));
vi.mock("~/lib/device-query-cache", () => ({
  captureDeviceReadAuthority: () => state.authority,
}));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: state.notify }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      client: { drawings: { createSet: { mutate: state.create } } },
      drawings: {
        listSets: { invalidate: state.sets },
        getSet: { invalidate: state.parent },
      },
      drawingsWorkspace: { list: { invalidate: state.summaries } },
    }),
  },
}));
const id = "11111111-1111-4111-8111-111111111111";
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (v: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const wrapper = Wrapper;
const defaults = {
  jobId: "job",
  parentId: null,
  viewId: null,
  enabled: true,
  onStart: vi.fn(),
  onRefused: vi.fn(),
  onCreated: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  state.account = { accountKey: "org:actor", userId: "actor" };
  state.authority = {};
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  state.sets.mockResolvedValue(undefined);
  state.summaries.mockResolvedValue(undefined);
  state.parent.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("paints a surviving pending name while form closes, refuses duplicates and uses only real ACK ID", async () => {
  const request = deferred<{ id: string }>();
  state.create.mockReturnValue(request.promise);
  function UI() {
    const [open, setOpen] = useState(true),
      [name, setName] = useState("Mechanical"),
      [folder, setFolder] = useState<string | null>(null);
    const create = useCreateDrawingSet({
      ...defaults,
      onStart: () => setOpen(false),
      onRefused: (name) => {
        setName(name);
        setOpen(true);
      },
      onCreated: setFolder,
    });
    return (
      <>
        {open && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.create(name);
            }}
          >
            <input
              aria-label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button>Create folder</button>
          </form>
        )}
        {create.pendingName && (
          <p role="status">Creating {create.pendingName}</p>
        )}
        <button onClick={() => create.create("duplicate")}>Again</button>
        {folder && <p>Real folder {folder}</p>}
      </>
    );
  }
  render(<UI />, { wrapper });
  fireEvent.click(screen.getByText("Create folder"));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Mechanical");
  fireEvent.click(screen.getByText("Again"));
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  expect(state.create).toHaveBeenCalledWith({
    jobId: "job",
    name: "Mechanical",
    expectedAccountKey: "org:actor",
  });
  expect(screen.queryByText(/Real folder/)).toBeNull();
  await act(async () => request.resolve({ id }));
  expect(screen.getByText(`Real folder ${id}`)).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(state.sets).toHaveBeenCalledWith({ jobId: "job" });
});
it("restores refused draft and leaves no invented folder or cached optimistic row", async () => {
  const request = deferred<{ id: string }>();
  state.create.mockReturnValue(request.promise);
  const { result } = renderHook(() => useCreateDrawingSet(defaults), {
    wrapper,
  });
  act(() => {
    result.current.create("  Electrical  ");
  });
  expect(result.current.pendingName).toBe("Electrical");
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  await act(async () => request.reject(new Error("FORBIDDEN")));
  expect(defaults.onRefused).toHaveBeenCalledWith("Electrical");
  expect(defaults.onCreated).not.toHaveBeenCalled();
  expect(result.current.pendingName).toBeNull();
  expect(result.current.error).toContain("check the folders");
});
it("rejects offline same-turn dispatch without enqueue/reconnect replay", async () => {
  const { result, rerender } = renderHook(() => useCreateDrawingSet(defaults), {
    wrapper,
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  act(() => {
    expect(result.current.create("Draft")).toBe(false);
  });
  expect(defaults.onStart).not.toHaveBeenCalled();
  expect(state.create).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  rerender();
  await act(async () => Promise.resolve());
  expect(state.create).not.toHaveBeenCalled();
});
for (const outcome of ["accept", "refuse"] as const)
  it(`reconciles captured parent after view switch on ${outcome}, without old-view callbacks`, async () => {
    const request = deferred<{ id: string }>();
    state.create.mockReturnValue(request.promise);
    const { result, rerender } = renderHook(
      ({ parentId }) => useCreateDrawingSet({ ...defaults, parentId }),
      { wrapper, initialProps: { parentId: "parent-one" } },
    );
    act(() => {
      result.current.create("Old view");
    });
    await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
    rerender({ parentId: "parent-two" });
    await act(async () =>
      outcome === "accept"
        ? request.resolve({ id })
        : request.reject(new Error("refused")),
    );
    expect(defaults.onCreated).not.toHaveBeenCalled();
    expect(defaults.onRefused).not.toHaveBeenCalled();
    expect(state.parent).toHaveBeenCalledWith({ setId: "parent-one" });
    expect(state.sets).toHaveBeenCalledWith({ jobId: "job" });
  });
for (const change of ["account", "authority"] as const)
  it(`never reconciles or delivers old callbacks after ${change} replacement`, async () => {
    const request = deferred<{ id: string }>();
    state.create.mockReturnValue(request.promise);
    const { result, rerender } = renderHook(
      () => useCreateDrawingSet(defaults),
      { wrapper },
    );
    act(() => {
      result.current.create("Private name");
    });
    await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
    if (change === "account")
      state.account = { accountKey: "org:other", userId: "other" };
    state.authority = {};
    rerender();
    expect(result.current.pendingName).toBeNull();
    await act(async () => request.resolve({ id }));
    expect(defaults.onCreated).not.toHaveBeenCalled();
    expect(state.sets).not.toHaveBeenCalled();
    expect(state.parent).not.toHaveBeenCalled();
    expect(state.summaries).not.toHaveBeenCalled();
  });
it("captures actor in input before TanStack's dispatch microtask", async () => {
  const { result, rerender } = renderHook(() => useCreateDrawingSet(defaults), {
    wrapper,
  });
  act(() => {
    result.current.create("Old actor");
    state.account = { accountKey: "org:other", userId: "other" };
    state.authority = {};
  });
  rerender();
  await act(async () => Promise.resolve());
  expect(state.create).not.toHaveBeenCalled();
  expect(defaults.onCreated).not.toHaveBeenCalled();
});
it("reconciles accepted request after unmount without UI navigation", async () => {
  const request = deferred<{ id: string }>();
  state.create.mockReturnValue(request.promise);
  const { result, unmount } = renderHook(() => useCreateDrawingSet(defaults), {
    wrapper,
  });
  act(() => {
    result.current.create("Folder");
  });
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  unmount();
  await act(async () => request.resolve({ id }));
  expect(defaults.onCreated).not.toHaveBeenCalled();
  expect(state.sets).toHaveBeenCalledOnce();
});
it("does not hold pending UI on paused refresh and never accepts a fabricated response ID", async () => {
  state.create.mockResolvedValue({ id: "not-a-real-id" });
  state.sets.mockReturnValue(new Promise(() => undefined));
  const { result } = renderHook(() => useCreateDrawingSet(defaults), {
    wrapper,
  });
  act(() => {
    result.current.create("Folder");
  });
  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(defaults.onCreated).not.toHaveBeenCalled();
  expect(defaults.onRefused).toHaveBeenCalledWith("Folder");
});
it("Activity hiding fences UI but retains same-account authoritative reconciliation", async () => {
  const request = deferred<{ id: string }>();
  state.create.mockReturnValue(request.promise);
  function UI() {
    const create = useCreateDrawingSet(defaults);
    return (
      <button onClick={() => create.create("Hidden")}>Create in panel</button>
    );
  }
  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <StrictMode>
        <Activity mode="visible">
          <UI />
        </Activity>
      </StrictMode>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Create in panel"));
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  rerender(
    <QueryClientProvider client={client}>
      <StrictMode>
        <Activity mode="hidden">
          <UI />
        </Activity>
      </StrictMode>
    </QueryClientProvider>,
  );
  await act(async () => request.resolve({ id }));
  expect(defaults.onCreated).not.toHaveBeenCalled();
  expect(state.sets).toHaveBeenCalledOnce();
});

it("does not navigate on A→B→A view reuse or overwrite a newer form", async () => {
  const request = deferred<{ id: string }>();
  state.create.mockReturnValue(request.promise);
  const { result, rerender } = renderHook(
    ({ viewId }) => useCreateDrawingSet({ ...defaults, viewId }),
    { wrapper, initialProps: { viewId: "form-one" } },
  );
  act(() => {
    result.current.create("Old draft");
  });
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  rerender({ viewId: "form-two" });
  rerender({ viewId: "form-one" });
  await act(async () => request.reject(new Error("refused")));
  expect(defaults.onRefused).not.toHaveBeenCalled();
  expect(defaults.onCreated).not.toHaveBeenCalled();
  expect(state.sets).toHaveBeenCalledOnce();
});
it("does not erase the synchronous latch if an onStart callback throws", async () => {
  const onStart = vi.fn(() => {
    throw new Error("view gone");
  });
  const { result } = renderHook(
    () => useCreateDrawingSet({ ...defaults, onStart }),
    { wrapper },
  );
  act(() => {
    result.current.create("Draft");
  });
  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(state.create).not.toHaveBeenCalled();
  act(() => {
    result.current.create("Retry");
  });
  expect(onStart).toHaveBeenCalledTimes(2);
});

it("finishes accepted real-ID intent without waiting for a paused refresh", async () => {
  state.create.mockResolvedValue({ id });
  state.sets.mockReturnValue(new Promise(() => undefined));
  const { result } = renderHook(() => useCreateDrawingSet(defaults), {
    wrapper,
  });
  act(() => {
    result.current.create("Accepted");
  });
  await waitFor(() => expect(defaults.onCreated).toHaveBeenCalledWith(id));
  expect(result.current.isPending).toBe(false);
});
it("fences old account A after A→B→A even if the authority token is accidentally unchanged", async () => {
  const request = deferred<{ id: string }>();
  state.create.mockReturnValue(request.promise);
  const { result, rerender } = renderHook(() => useCreateDrawingSet(defaults), {
    wrapper,
  });
  act(() => {
    result.current.create("A draft");
  });
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  state.account = { accountKey: "org:B", userId: "B" };
  rerender();
  state.account = { accountKey: "org:actor", userId: "actor" };
  rerender();
  expect(result.current.pendingName).toBeNull();
  await act(async () => request.resolve({ id }));
  expect(defaults.onCreated).not.toHaveBeenCalled();
  expect(state.sets).not.toHaveBeenCalled();
});
