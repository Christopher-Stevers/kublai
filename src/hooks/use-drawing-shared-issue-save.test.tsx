import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  drawingIssueSchema,
  type DrawingEntity,
  type DrawingSave,
  type DrawingWorkspace,
} from "~/lib/drawing-workspace";
import { useDrawingSharedIssueSave } from "./use-drawing-shared-issue-save";
const state = vi.hoisted(() => ({
  save: vi.fn(),
  get: vi.fn(),
  invalidate: vi.fn(),
  accepted: vi.fn(),
  failure: vi.fn(),
  message: vi.fn(),
  account: { accountKey: "org:actor", userId: "actor" },
  authority: {} as object,
}));
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({
  useDrawingAccount: () => state.account,
}));
vi.mock("~/lib/device-query-cache", () => ({
  captureDeviceReadAuthority: () => state.authority,
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (_p: unknown, input: unknown) => ["drawing", input],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: { get: {} },
    useUtils: () => ({
      client: {
        drawingsWorkspace: {
          save: { mutate: state.save },
          get: { query: state.get },
        },
      },
      drawingsWorkspace: {
        get: { invalidate: state.invalidate },
        list: { invalidate: state.invalidate },
      },
    }),
  },
}));
const sheet = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const data = drawingIssueSchema.parse({
  sourceSheetId: sheet,
  type: "issue",
  point: { x: 0.5, y: 0.5 },
  title: "Old issue",
});
const entity: DrawingEntity = {
  id,
  sheetId: sheet,
  kind: "issue",
  data,
  visibility: "published",
  revision: 4,
  authorId: "actor",
  authorName: "Actor",
  createdAt: "real",
  updatedAt: "real",
  comments: [],
};
const draft: DrawingSave = {
  sheetId: sheet,
  id,
  expectedRevision: 4,
  kind: "issue",
  visibility: "published",
  data: { ...data, title: "Proposed title" },
};
const key = ["drawing", { sheetId: sheet }];
let client: QueryClient;
function workspace(row = entity): DrawingWorkspace {
  return {
    sheetId: sheet,
    revision: "snapshot-a",
    actor: { id: "actor" },
    entities: [row],
  } as DrawingWorkspace;
}
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function options(viewScope = "editor") {
  return {
    sheetId: sheet,
    jobId: "job",
    omitHyperlinks: false,
    viewScope,
    viewEntityId: id,
    workspace: client.getQueryData<DrawingWorkspace>(key),
    canStart: () => true,
    onAccepted: state.accepted,
    onFailure: state.failure,
    onMessage: state.message,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.account = { accountKey: "org:actor", userId: "actor" };
  state.authority = {};
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(key, workspace());
  state.save.mockResolvedValue({ ...entity, data: draft.data, revision: 5 });
  state.get.mockResolvedValue(workspace());
  state.invalidate.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
it("only handles existing own published issues and leaves private queue/other kinds alone", () => {
  const { result } = renderHook(() => useDrawingSharedIssueSave(options()), {
    wrapper: Wrapper,
  });
  expect(
    result.current.trySave({ ...draft, visibility: "private" }),
  ).toBeNull();
  expect(result.current.trySave({ ...draft, expectedRevision: 0 })).toBeNull();
  expect(state.save).not.toHaveBeenCalled();
});
it("latches per entity immediately, waits for real ACK, and ignores hung refresh", async () => {
  const request = deferred<DrawingEntity>();
  state.save.mockReturnValue(request.promise);
  state.invalidate.mockReturnValue(new Promise(() => undefined));
  const { result } = renderHook(() => useDrawingSharedIssueSave(options()), {
    wrapper: Wrapper,
  });
  let first!: Promise<boolean> | null;
  act(() => {
    first = result.current.trySave(draft);
    void result.current.trySave(draft);
  });
  expect(result.current.isPending).toBe(true);
  expect(client.getQueryData<DrawingWorkspace>(key)?.entities[0]?.data).toEqual(
    data,
  );
  await act(async () => Promise.resolve());
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.save).toHaveBeenCalledWith({
    ...draft,
    expectedUserId: "actor",
    expectedAccountKey: "org:actor",
  });
  await act(async () => {
    request.resolve({ ...entity, data: draft.data, revision: 5 });
    expect(await first).toBe(true);
  });
  expect(state.accepted).toHaveBeenCalledOnce();
  expect(result.current.isPending).toBe(false);
  expect(state.failure).not.toHaveBeenCalled();
});
it("does not pause/replay after losing connectivity before dispatch", async () => {
  const { result } = renderHook(() => useDrawingSharedIssueSave(options()), {
    wrapper: Wrapper,
  });
  await act(async () => {
    const work = result.current.trySave(draft);
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    await work;
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  await act(async () => Promise.resolve());
  expect(state.save).not.toHaveBeenCalled();
  expect(result.current.needsRecovery).toBe(false);
});
it("newer server entity wins over an old ACK", async () => {
  const request = deferred<DrawingEntity>();
  state.save.mockReturnValue(request.promise);
  const { result } = renderHook(() => useDrawingSharedIssueSave(options()), {
    wrapper: Wrapper,
  });
  let work!: Promise<boolean> | null;
  act(() => {
    work = result.current.trySave(draft);
  });
  await act(async () => Promise.resolve());
  client.setQueryData(
    key,
    workspace({
      ...entity,
      revision: 8,
      data: { ...data, title: "Remote newer" },
    }),
  );
  await act(async () => {
    request.resolve({ ...entity, revision: 5 });
    await work;
  });
  expect(
    client.getQueryData<DrawingWorkspace>(key)?.entities[0]?.revision,
  ).toBe(8);
  expect(state.accepted).toHaveBeenCalledOnce();
});
it.each(["account", "authority", "view", "unmount"])(
  "fences late %s callbacks with account-only reconciliation",
  async (mode) => {
    const request = deferred<DrawingEntity>();
    state.save.mockReturnValue(request.promise);
    const { result, rerender, unmount } = renderHook(
      ({ scope }) => useDrawingSharedIssueSave(options(scope)),
      { wrapper: Wrapper, initialProps: { scope: "one" } },
    );
    let work!: Promise<boolean> | null;
    act(() => {
      work = result.current.trySave(draft);
    });
    await act(async () => Promise.resolve());
    if (mode === "account")
      state.account = { accountKey: "other", userId: "other" };
    if (mode === "authority") state.authority = {};
    if (mode === "unmount") unmount();
    else rerender({ scope: mode === "view" ? "two" : "one" });
    await act(async () => {
      request.resolve({ ...entity, revision: 5 });
      await work;
    });
    expect(state.accepted).not.toHaveBeenCalled();
    expect(state.failure).not.toHaveBeenCalled();
    expect(state.invalidate).toHaveBeenCalledTimes(
      mode === "view" || mode === "unmount" ? 2 : 0,
    );
  },
);
it("unknown ACK cannot be resent; recovery only reads and requires reopened editor", async () => {
  state.save.mockRejectedValue(Error("ACK lost"));
  const { result, rerender } = renderHook(
    ({ scope }) => useDrawingSharedIssueSave(options(scope)),
    { wrapper: Wrapper, initialProps: { scope: "one" } },
  );
  await act(async () => {
    await result.current.trySave(draft);
  });
  expect(result.current.needsRecovery).toBe(true);
  await act(async () => {
    await result.current.trySave(draft);
  });
  expect(state.save).toHaveBeenCalledOnce();
  rerender({ scope: "reopened-before-check" });
  expect(result.current.needsRecovery).toBe(true);
  await act(async () => result.current.recover());
  expect(state.get).toHaveBeenCalledOnce();
  await act(async () => {
    await result.current.trySave(draft);
  });
  expect(state.save).toHaveBeenCalledOnce();
  rerender({ scope: "closed" });
  rerender({ scope: "reopened-after-check" });
  state.save.mockResolvedValue({ ...entity, revision: 5 });
  await act(async () => {
    await result.current.trySave(draft);
  });
  expect(state.save).toHaveBeenCalledTimes(2);
});
it("known refusal keeps draft without treating it as an uncertain ACK", async () => {
  state.save.mockRejectedValue(
    Object.assign(Error("Read only"), { data: { code: "FORBIDDEN" } }),
  );
  const { result } = renderHook(() => useDrawingSharedIssueSave(options()), {
    wrapper: Wrapper,
  });
  await act(async () => {
    await result.current.trySave(draft);
  });
  expect(state.failure).toHaveBeenCalledWith(
    expect.objectContaining({ id }),
    "Read only",
  );
  expect(result.current.needsRecovery).toBe(false);
});
it("latches read recovery synchronously and old read completion cannot clear a newer view read", async () => {
  state.save.mockRejectedValue(Error("ACK lost"));
  const first = deferred<DrawingWorkspace>(),
    second = deferred<DrawingWorkspace>();
  state.get
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { result, rerender } = renderHook(
    ({ scope }) => useDrawingSharedIssueSave(options(scope)),
    { wrapper: Wrapper, initialProps: { scope: "one" } },
  );
  await act(async () => {
    await result.current.trySave(draft);
  });
  let readOne!: Promise<void>, readTwo!: Promise<void>;
  act(() => {
    readOne = result.current.recover();
    void result.current.recover();
  });
  expect(state.get).toHaveBeenCalledOnce();
  rerender({ scope: "two" });
  act(() => {
    readTwo = result.current.recover();
    void result.current.recover();
  });
  expect(state.get).toHaveBeenCalledTimes(2);
  await act(async () => {
    first.resolve(workspace());
    await readOne;
  });
  expect(result.current.checking).toBe(true);
  await act(async () => result.current.recover());
  expect(state.get).toHaveBeenCalledTimes(2);
  await act(async () => {
    second.resolve(workspace());
    await readTwo;
  });
  expect(result.current.checking).toBe(false);
});

it("aborted old recovery cannot write error text into another account/view", async () => {
  state.save.mockRejectedValue(Error("ACK lost"));
  const read = deferred<DrawingWorkspace>();
  state.get.mockReturnValue(read.promise);
  const { result, rerender } = renderHook(
    () => useDrawingSharedIssueSave(options()),
    { wrapper: Wrapper },
  );
  await act(async () => {
    await result.current.trySave(draft);
  });
  let recovery!: Promise<void>;
  act(() => {
    recovery = result.current.recover();
  });
  state.message.mockClear();
  state.account = { accountKey: "other", userId: "other" };
  rerender();
  await act(async () => {
    read.reject(Error("aborted"));
    await recovery;
  });
  expect(state.message).not.toHaveBeenCalled();
});
it("two uncertain entities retain independent visible recovery after reopening the first", async () => {
  const otherId = "33333333-3333-4333-8333-333333333333",
    otherEntity = {
      ...entity,
      id: otherId,
      data: { ...data, title: "Other unchanged" },
    };
  client.setQueryData(key, { ...workspace(), entities: [entity, otherEntity] });
  state.save.mockRejectedValue(Error("ACK lost"));
  const { result, rerender } = renderHook(
    ({ scope, target }) =>
      useDrawingSharedIssueSave({ ...options(scope), viewEntityId: target }),
    { wrapper: Wrapper, initialProps: { scope: "A", target: id } },
  );
  await act(async () => {
    await result.current.trySave(draft);
  });
  rerender({ scope: "B", target: otherId });
  await act(async () => {
    await result.current.trySave({ ...draft, id: otherId });
  });
  rerender({ scope: "A-reopened", target: id });
  expect(result.current.needsRecovery).toBe(true);
  state.accepted.mockClear();
  state.failure.mockClear();
  state.get.mockResolvedValue({
    ...workspace({ ...entity, revision: 6 }),
    entities: [
      { ...entity, revision: 6 },
      {
        ...otherEntity,
        revision: 9,
        data: { ...data, title: "Unrelated read result" },
      },
    ],
  });
  await act(async () => result.current.recover());
  expect(state.get).toHaveBeenCalledOnce();
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.accepted).not.toHaveBeenCalled();
  expect(state.failure).not.toHaveBeenCalled();
  expect(
    client
      .getQueryData<DrawingWorkspace>(key)
      ?.entities.find((row) => row.id === otherId),
  ).toEqual(otherEntity);
  rerender({ scope: "B-reopened", target: otherId });
  expect(result.current.needsRecovery).toBe(true);
  await act(async () => {
    await result.current.trySave({ ...draft, id: otherId });
  });
  expect(state.save).toHaveBeenCalledTimes(2);
});

it.each([
  [undefined, undefined],
  [undefined, "hash-new"],
  ["hash-old", undefined],
  ["ffff", "0000"],
  ["0000", "ffff"],
] as const)(
  "missing issue is preserved with unorderable workspace tokens %s / %s",
  async (oldRevision, responseRevision) => {
    client.setQueryData(key, { ...workspace(), revision: oldRevision });
    state.save.mockRejectedValue(Error("ACK lost"));
    const read = deferred<DrawingWorkspace>();
    state.get.mockReturnValue(read.promise);
    const { result } = renderHook(() => useDrawingSharedIssueSave(options()), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.trySave(draft);
    });
    let recovery!: Promise<void>;
    act(() => {
      recovery = result.current.recover();
    });
    expect(client.getQueryData<DrawingWorkspace>(key)?.entities).toEqual([
      entity,
    ]);
    await act(async () => {
      read.resolve({
        ...workspace(),
        revision: responseRevision,
        entities: [],
      });
      await recovery;
    });
    expect(client.getQueryData<DrawingWorkspace>(key)?.entities).toEqual([
      entity,
    ]);
    expect(result.current.needsRecovery).toBe(true);
    expect(state.message).toHaveBeenLastCalledWith(
      expect.stringContaining("not returned"),
    );
    await act(async () => {
      await result.current.trySave(draft);
    });
    expect(state.save).toHaveBeenCalledOnce();
  },
);
