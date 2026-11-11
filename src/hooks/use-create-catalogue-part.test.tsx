import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  account: { accountKey: "org:actor" } as { accountKey: string } | null,
  authority: {},
  create: vi.fn(),
  invalidate: vi.fn(),
  pull: vi.fn(),
}));
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({
  useDrawingAccount: () => state.account,
}));
vi.mock("~/lib/device-query-cache", () => ({
  captureDeviceReadAuthority: () => state.authority,
}));
vi.mock("~/lib/replicache-catalogue", () => ({
  requestCatalogueReplicachePull: state.pull,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      client: { catalogue: { createPart: { mutate: state.create } } },
      catalogue: {
        searchParts: { invalidate: state.invalidate },
        getPartWizardSummary: { invalidate: state.invalidate },
        getPart: { invalidate: state.invalidate },
      },
    }),
  },
}));
import {
  useCreateCataloguePart,
  unconfirmedPartCreation,
} from "./use-create-catalogue-part";
const input = { displayName: "Valve", catalogId: "catalog", currency: "CAD" };
const accepted = {
  id: "actual-part",
  displayName: "Valve",
  supplierPartId: "actual-link",
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.account = { accountKey: "org:actor" };
  state.authority = {};
  state.invalidate.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});
afterEach(cleanup);
it("shows pending immediately, sends once, and hands off the actual ID without waiting for refresh", async () => {
  const write = deferred<typeof accepted>();
  state.create.mockReturnValue(write.promise);
  state.invalidate.mockReturnValue(new Promise(() => undefined));
  const created = vi.fn();
  const { result } = renderHook(() =>
    useCreateCataloguePart({
      enabled: true,
      scope: "form",
      onCreated: created,
    }),
  );
  let first!: Promise<boolean>, second!: Promise<boolean>;
  act(() => {
    first = result.current.create(input);
    second = result.current.create(input);
  });
  expect(result.current.isPending).toBe(true);
  expect(state.create).toHaveBeenCalledExactlyOnceWith({
    ...input,
    expectedAccountKey: "org:actor",
  });
  expect(await second).toBe(false);
  expect(created).not.toHaveBeenCalled();
  await act(async () => {
    write.resolve(accepted);
    expect(await first).toBe(true);
  });
  expect(created).toHaveBeenCalledExactlyOnceWith(accepted);
  expect(result.current.isPending).toBe(false);
  expect(state.pull).toHaveBeenCalledOnce();
});
it("checks actual connectivity at dispatch and does not replay on reconnect", async () => {
  const { result, rerender } = renderHook(() =>
    useCreateCataloguePart({
      enabled: true,
      scope: "form",
      onCreated: vi.fn(),
    }),
  );
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  await act(async () => {
    expect(await result.current.create(input)).toBe(false);
  });
  expect(result.current.error).toContain("Reconnect");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  rerender();
  expect(state.create).not.toHaveBeenCalled();
});
it("keeps uncertain outcomes explicit and refreshes without automatically creating again", async () => {
  state.create.mockRejectedValue(new Error("network response lost"));
  const created = vi.fn();
  const { result } = renderHook(() =>
    useCreateCataloguePart({
      enabled: true,
      scope: "form",
      onCreated: created,
    }),
  );
  await act(async () => {
    expect(await result.current.create(input)).toBe(false);
  });
  expect(result.current.error).toBe(unconfirmedPartCreation);
  expect(created).not.toHaveBeenCalled();
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.pull).toHaveBeenCalledOnce();
});
it("shows a real pre-write refusal without closing the draft", async () => {
  state.create.mockRejectedValue(
    Object.assign(new Error("No catalogue permission"), {
      data: { code: "FORBIDDEN" },
    }),
  );
  const created = vi.fn();
  const { result } = renderHook(() =>
    useCreateCataloguePart({
      enabled: true,
      scope: "form",
      onCreated: created,
    }),
  );
  await act(async () => {
    await result.current.create(input);
  });
  expect(result.current.error).toBe("No catalogue permission");
  expect(created).not.toHaveBeenCalled();
});
for (const outcome of ["accept", "error"] as const)
  it(`ignores late ${outcome} after form close/reopen but still reconciles the same account`, async () => {
    const write = deferred<typeof accepted>();
    state.create.mockReturnValue(write.promise);
    const created = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useCreateCataloguePart({
          enabled,
          scope: `form:${enabled}`,
          onCreated: created,
        }),
      { initialProps: { enabled: true } },
    );
    let request!: Promise<boolean>;
    act(() => {
      request = result.current.create(input);
    });
    rerender({ enabled: false });
    rerender({ enabled: true });
    await act(async () => {
      if (outcome === "accept") write.resolve(accepted);
      else write.reject(Error("late"));
      await request;
    });
    expect(created).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(state.pull).toHaveBeenCalledOnce();
  });
for (const changed of ["account", "authority", "same-key-binding"] as const)
  it(`fences ${changed} replacement from the old response`, async () => {
    const write = deferred<typeof accepted>();
    state.create.mockReturnValue(write.promise);
    const created = vi.fn();
    const { result, rerender } = renderHook(() =>
      useCreateCataloguePart({
        enabled: true,
        scope: "form",
        onCreated: created,
      }),
    );
    let request!: Promise<boolean>;
    act(() => {
      request = result.current.create(input);
    });
    if (changed === "authority") state.authority = {};
    else
      state.account = {
        accountKey: changed === "account" ? "other:actor" : "org:actor",
      };
    rerender();
    await act(async () => {
      write.resolve(accepted);
      await request;
    });
    expect(created).not.toHaveBeenCalled();
    expect(state.pull).not.toHaveBeenCalled();
    expect(state.invalidate).not.toHaveBeenCalled();
  });
it("reconciles an accepted unmounted request without reviving the closed view", async () => {
  const write = deferred<typeof accepted>();
  state.create.mockReturnValue(write.promise);
  const created = vi.fn();
  const { result, unmount } = renderHook(() =>
    useCreateCataloguePart({
      enabled: true,
      scope: "form",
      onCreated: created,
    }),
  );
  let request!: Promise<boolean>;
  act(() => {
    request = result.current.create(input);
  });
  unmount();
  write.resolve(accepted);
  await request;
  expect(created).not.toHaveBeenCalled();
  expect(state.pull).toHaveBeenCalledOnce();
});
it("consumes a real ACK when connectivity changes but the same form remains open", async () => {
  const write = deferred<typeof accepted>();
  state.create.mockReturnValue(write.promise);
  const created = vi.fn();
  const { result, rerender } = renderHook(
    ({ enabled }) =>
      useCreateCataloguePart({
        enabled,
        scope: "same-open-form",
        onCreated: created,
      }),
    { initialProps: { enabled: true } },
  );
  let request!: Promise<boolean>;
  act(() => {
    request = result.current.create(input);
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  rerender({ enabled: false });
  await act(async () => {
    write.resolve(accepted);
    expect(await request).toBe(true);
  });
  expect(created).toHaveBeenCalledExactlyOnceWith(accepted);
});
it("does not lose a confirmed creation if reconciliation throws synchronously", async () => {
  state.create.mockResolvedValue(accepted);
  state.pull.mockImplementationOnce(() => {
    throw Error("pull failed");
  });
  state.invalidate.mockImplementation(() => {
    throw Error("cache failed");
  });
  const created = vi.fn();
  const { result } = renderHook(() =>
    useCreateCataloguePart({
      enabled: true,
      scope: "form",
      onCreated: created,
    }),
  );
  await act(async () => {
    expect(await result.current.create(input)).toBe(true);
  });
  expect(created).toHaveBeenCalledExactlyOnceWith(accepted);
  expect(result.current.error).toBeNull();
});
