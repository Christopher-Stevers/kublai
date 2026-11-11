import { act, cleanup, renderHook } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDrawingScaleSave } from "./use-drawing-scale-save";
import type {
  DrawingMetadata,
  DrawingWorkspace,
} from "~/lib/drawing-workspace";
const state = vi.hoisted(() => ({
  save: vi.fn(),
  cancel: vi.fn(),
  invalidate: vi.fn(),
  setData: vi.fn(),
  accepted: vi.fn(),
  error: vi.fn(),
  authority: {} as object,
  account: { accountKey: "org:actor", userId: "actor" },
  client: null as QueryClient | null,
  revision: 8,
}));
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({
  useDrawingAccount: () => state.account,
}));
vi.mock("~/lib/device-query-cache", () => ({
  captureDeviceReadAuthority: () => state.authority,
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (_proc: unknown, input: unknown) => ["drawing", input],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: { get: {} },
    useUtils: () => ({
      client: { drawingsWorkspace: { setScale: { mutate: state.save } } },
      drawingsWorkspace: {
        get: {
          cancel: state.cancel,
          invalidate: state.invalidate,
          setData: (
            input: unknown,
            update: (
              old: DrawingWorkspace | undefined,
            ) => DrawingWorkspace | undefined,
          ) => {
            state.setData(input);
            state.client!.setQueryData(["drawing", input], update);
          },
        },
        list: { invalidate: state.invalidate },
      },
    }),
  },
}));
const sheetId = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const scale = { unit: "m" as const, unitsPerSheetWidth: 120 };
function metadata(revision = 9, units = 120): DrawingMetadata {
  return {
    revision,
    currentSourceSheetId: sheetId,
    number: "M1",
    title: "Plan",
    discipline: "Mechanical",
    tags: [],
    status: "draft",
    scale: { unit: "m", unitsPerSheetWidth: units },
  };
}
const key = ["drawing", { sheetId }];
const options = {
  sheetId,
  jobId: "job",
  sourceId: sheetId,
  omitHyperlinks: false,
  canStart: () => true,
  currentAcceptedRevision: () => state.revision,
  onAccepted: state.accepted,
  onError: state.error,
};
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (v: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(state.client!);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.authority = {};
  state.account = { accountKey: "org:actor", userId: "actor" };
  state.revision = 8;
  state.client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  state.client.setQueryData(key, { sheetId, metadata: metadata(8, 80) });
  state.cancel.mockResolvedValue(undefined);
  state.invalidate.mockResolvedValue(undefined);
  state.save.mockResolvedValue(metadata());
  onlineManager.setOnline(true);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});
afterEach(() => {
  cleanup();
  state.client?.clear();
  onlineManager.setOnline(true);
});
it("does not preview scale, synchronously refuses duplicate and sends captured actor once", async () => {
  const request = deferred<DrawingMetadata>();
  state.save.mockReturnValue(request.promise);
  const { result } = renderHook(() => useDrawingScaleSave(options), {
    wrapper: Wrapper,
  });
  let pending!: ReturnType<typeof result.current.save>;
  let duplicate!: ReturnType<typeof result.current.save>;
  act(() => {
    pending = result.current.save(scale);
    duplicate = result.current.save(scale);
  });
  expect(result.current.isPending).toBe(true);
  expect(await duplicate).toBe(false);
  expect(
    state.client!.getQueryData<DrawingWorkspace>(key)?.metadata.scale
      ?.unitsPerSheetWidth,
  ).toBe(80);
  await act(async () => {
    await Promise.resolve();
  });
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.save).toHaveBeenCalledWith({
    sheetId,
    scale,
    expectedAccountKey: "org:actor",
  });
  await act(async () => {
    request.resolve(metadata());
    await pending;
  });
  expect(state.accepted).toHaveBeenCalledWith(metadata());
  expect(result.current.isPending).toBe(false);
});
it("does not pause/replay when browser goes offline between admission and dispatch", async () => {
  const { result } = renderHook(() => useDrawingScaleSave(options), {
    wrapper: Wrapper,
  });
  let pending!: ReturnType<typeof result.current.save>;
  act(() => {
    pending = result.current.save(scale);
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    onlineManager.setOnline(false);
  });
  await act(async () => {
    expect(await pending).toMatchObject({ accepted: false });
  });
  expect(state.save).not.toHaveBeenCalled();
  const mutation = state.client!.getMutationCache().getAll()[0]!;
  expect(mutation.options.networkMode).toBe("always");
  expect(mutation.options.retry).toBe(false);
  expect(mutation.state.isPaused).toBe(false);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  onlineManager.setOnline(true);
  await act(async () => Promise.resolve());
  expect(state.save).not.toHaveBeenCalled();
});
it("rejects already offline without constructing a mutation", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  const { result } = renderHook(() => useDrawingScaleSave(options), {
    wrapper: Wrapper,
  });
  expect(await result.current.save(scale)).toBe(false);
  expect(state.client!.getMutationCache().getAll()).toHaveLength(0);
});
it("resolves real ACK without waiting for hung cancel or refresh", async () => {
  state.cancel.mockReturnValue(new Promise(() => undefined));
  state.invalidate.mockReturnValue(new Promise(() => undefined));
  const { result } = renderHook(() => useDrawingScaleSave(options), {
    wrapper: Wrapper,
  });
  let ack: unknown;
  await act(async () => {
    ack = await result.current.save(scale);
  });
  expect(ack).toEqual({ accepted: true, scale, applyToView: true });
  expect(result.current.isPending).toBe(false);
  expect(state.invalidate).toHaveBeenCalledTimes(2);
});
it("a newer query revision wins and never finishes the older proposal", async () => {
  const request = deferred<DrawingMetadata>();
  state.save.mockReturnValue(request.promise);
  const { result } = renderHook(() => useDrawingScaleSave(options), {
    wrapper: Wrapper,
  });
  let pending!: ReturnType<typeof result.current.save>;
  act(() => {
    pending = result.current.save(scale);
  });
  await act(async () => Promise.resolve());
  state.client!.setQueryData(key, { sheetId, metadata: metadata(10, 240) });
  let ack: unknown;
  await act(async () => {
    request.resolve(metadata(9));
    ack = await pending;
  });
  expect(ack).toEqual({
    accepted: true,
    scale: { unit: "m", unitsPerSheetWidth: 240 },
    applyToView: false,
  });
  expect(state.accepted).not.toHaveBeenCalled();
  expect(
    state.client!.getQueryData<DrawingWorkspace>(key)?.metadata.revision,
  ).toBe(10);
});
it("a newer accepted local revision fences an older ACK even if query metadata lags", async () => {
  const request = deferred<DrawingMetadata>();
  state.save.mockReturnValue(request.promise);
  const { result } = renderHook(() => useDrawingScaleSave(options), {
    wrapper: Wrapper,
  });
  let pending!: ReturnType<typeof result.current.save>;
  act(() => {
    pending = result.current.save(scale);
  });
  await act(async () => Promise.resolve());
  state.revision = 10;
  let ack: unknown;
  await act(async () => {
    request.resolve(metadata(9));
    ack = await pending;
  });
  expect(ack).toMatchObject({ accepted: true, applyToView: false });
  expect(state.setData).not.toHaveBeenCalled();
  expect(state.accepted).not.toHaveBeenCalled();
});
for (const change of ["account", "authority", "same-sheet-navigation"] as const)
  it(`fences late ${change} without old UI/actor cache writes`, async () => {
    const request = deferred<DrawingMetadata>();
    state.save.mockReturnValue(request.promise);
    const { result, rerender } = renderHook(
      ({ sourceId }) => useDrawingScaleSave({ ...options, sourceId }),
      { wrapper: Wrapper, initialProps: { sourceId: sheetId } },
    );
    let pending!: ReturnType<typeof result.current.save>;
    act(() => {
      pending = result.current.save(scale);
    });
    await act(async () => Promise.resolve());
    if (change === "account") {
      state.account = { accountKey: "org:other", userId: "other" };
      state.authority = {};
    }
    if (change === "authority") state.authority = {};
    rerender({
      sourceId: change === "same-sheet-navigation" ? other : sheetId,
    });
    let ack: unknown;
    await act(async () => {
      request.resolve(metadata());
      ack = await pending;
    });
    expect(ack).toMatchObject({ accepted: true, applyToView: false });
    expect(state.accepted).not.toHaveBeenCalled();
    if (change !== "same-sheet-navigation") {
      expect(state.setData).not.toHaveBeenCalled();
      expect(state.invalidate).not.toHaveBeenCalled();
    } else expect(state.invalidate).toHaveBeenCalledTimes(2);
  });
it("reconciles sent write after unmount but does not finish old viewer", async () => {
  const request = deferred<DrawingMetadata>();
  state.save.mockReturnValue(request.promise);
  const { result, unmount } = renderHook(() => useDrawingScaleSave(options), {
    wrapper: Wrapper,
  });
  let pending!: ReturnType<typeof result.current.save>;
  act(() => {
    pending = result.current.save(scale);
  });
  await act(async () => Promise.resolve());
  unmount();
  let ack: unknown;
  await act(async () => {
    request.resolve(metadata());
    ack = await pending;
  });
  expect(ack).toMatchObject({ accepted: true, applyToView: false });
  expect(state.accepted).not.toHaveBeenCalled();
  expect(state.invalidate).toHaveBeenCalledTimes(2);
});
it("refusal keeps prior authoritative scale for the viewer's existing retry draft", async () => {
  state.save.mockRejectedValue(
    Object.assign(new Error("refused"), { data: { code: "FORBIDDEN" } }),
  );
  const { result } = renderHook(() => useDrawingScaleSave(options), {
    wrapper: Wrapper,
  });
  let ack: unknown;
  await act(async () => {
    ack = await result.current.save(scale);
  });
  expect(ack).toMatchObject({ accepted: false, message: "refused" });
  expect(state.error).toHaveBeenCalledOnce();
  expect(
    state.client!.getQueryData<DrawingWorkspace>(key)?.metadata.scale
      ?.unitsPerSheetWidth,
  ).toBe(80);
  expect(state.accepted).not.toHaveBeenCalled();
});

it("lost ACK is unknown, retains data and never retries on reconnect", async () => {
  state.save.mockRejectedValue(new TypeError("network failed"));
  const { result } = renderHook(() => useDrawingScaleSave(options), {
    wrapper: Wrapper,
  });
  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.save(scale);
  });
  expect(outcome).toHaveProperty("accepted", false);
  expect((outcome as { message: string }).message).toContain(
    "Refresh to check",
  );
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);
  await act(async () => Promise.resolve());
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.accepted).not.toHaveBeenCalled();
});
