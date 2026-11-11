import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
import {
  DrawingOfflineStore,
  setDrawingOfflineAccount,
  type SnapshotAuthority,
} from "~/lib/drawing-offline";
import {
  captureDeviceReadAuthority,
  startDeviceQueryCache,
} from "~/lib/device-query-cache";
import {
  makeReceivingOrderReading,
  RECEIVING_ACCOUNT_CHANGED_MESSAGE,
} from "~/lib/receiving-order-reading";
import {
  useReceivingOrderRead,
  useReceivingOrderReads,
} from "./use-receiving-order-read";
import { SavedOrderReading } from "~/components/materialLists/SavedOrderReading";
vi.mock("~/lib/pdf-client", () => ({ sourcePdfPage: () => null }));
const state = vi.hoisted(() => ({
  account: null as null | {
    accountKey: string;
    userId: string;
    organizationId: string;
    store: unknown;
  },
  rpc: vi.fn(),
}));
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({
  useDrawingAccount: () => state.account,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      client: { materialList: { getOrderById: { query: state.rpc } } },
    }),
    materialList: {
      getOrderById: {
        _def: () => ({ path: ["materialList", "getOrderById"] }),
      },
    },
  },
}));
const idb = new IDBFactory();
const orderId = "11111111-1111-4111-8111-111111111111",
  listId = "22222222-2222-4222-8222-222222222222";
const live = (number = "PO-1") => ({
  id: orderId,
  materialListId: listId,
  jobId: "job",
  orderNumber: number,
  supplier: { name: "Supplier", contactEmail: "secret@example.invalid" },
  notes: "do not persist",
  status: "sent",
  items: [
    {
      id: "line",
      descriptionSnapshot: "Copper",
      supplierSkuSnapshot: "CU",
      quantity: "10",
      receivedQuantity: "7",
      creditedQuantity: "2",
      verificationStatus: "complete",
    },
  ],
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let client: QueryClient, cache: ReturnType<typeof startDeviceQueryCache>;
let last: ReturnType<typeof useReceivingOrderRead>;
function Screen({
  id = orderId,
  saveReading = true,
  headerReady = true,
  jobId = "job",
}: {
  id?: string;
  saveReading?: boolean;
  headerReady?: boolean;
  jobId?: string | null;
}) {
  const result = useReceivingOrderRead({
    orderId: id,
    materialListId: listId,
    jobId,
    headerReady,
    saveReading,
  });
  useLayoutEffect(() => {
    last = result;
  }, [result]);
  return (
    <>
      <output aria-label="Live order">
        {result.data?.orderNumber ?? "no live order"}
      </output>
      {result.savedReading && (
        <SavedOrderReading
          reading={result.savedReading}
          refreshing={result.isFetching}
          online={navigator.onLine}
        />
      )}
    </>
  );
}
function tree(id = orderId, saveReading = true) {
  return (
    <QueryClientProvider client={client}>
      <Screen id={id} saveReading={saveReading} />
    </QueryClientProvider>
  );
}
beforeEach(async () => {
  vi.stubGlobal("indexedDB", idb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const memory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  await setDrawingOfflineAccount("org:reader");
  await new DrawingOfflineStore("org:reader").clear();
  state.account = {
    accountKey: "org:reader",
    userId: "reader",
    organizationId: "org",
    store: new DrawingOfflineStore("org:reader"),
  };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 300000 } },
  });
  cache = startDeviceQueryCache(client, "org:reader");
  await cache.ready;
  state.rpc.mockReset();
});
afterEach(async () => {
  cleanup();
  client.clear();
  await cache.stop();
  await setDrawingOfflineAccount(null);
  vi.unstubAllGlobals();
});
async function saved(number = "SAVED") {
  const store = state.account!.store as DrawingOfflineStore;
  const token = await store.captureSnapshotAuthority(
    `receiving-order:${orderId}`,
  );
  await store.saveSnapshotWithAuthority(
    token,
    makeReceivingOrderReading(live(number), "job"),
  );
  return { store, token };
}
it("paints only a labelled reading before real HTTP and replaces it with the fresh raw order", async () => {
  const { store } = await saved();
  const pending = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValue(pending.promise);
  render(tree());
  expect(
    await screen.findByRole("region", { name: "Saved order" }),
  ).toHaveTextContent("SAVED");
  expect(screen.getByLabelText("Live order")).toHaveTextContent(
    "no live order",
  );
  expect(screen.queryByRole("button")).toBeNull();
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  expect(state.rpc.mock.calls[0]![0]).toEqual({
    orderId,
    expectedAccountKey: "org:reader",
  });
  await act(async () => {
    pending.resolve(live("FRESH"));
    await pending.promise;
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Live order")).toHaveTextContent("FRESH"),
  );
  expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull();
  const token = await store.captureSnapshotAuthority(
    `receiving-order:${orderId}`,
  );
  await waitFor(async () =>
    expect(await store.readSnapshotWithAuthority(token)).toMatchObject({
      orderNumber: "FRESH",
    }),
  );
  const disk = JSON.stringify(await store.readSnapshotWithAuthority(token));
  for (const secret of [
    "contactEmail",
    "do not persist",
    "receivedQuantity",
    "creditedQuantity",
    "verificationStatus",
    '"status"',
  ])
    expect(disk).not.toContain(secret);
});
it("retains saved paint on transport failure but removes only its order on terminal denial", async () => {
  const { store } = await saved();
  const other = await store.captureSnapshotAuthority("receiving-order:other");
  await store.saveSnapshotWithAuthority(other, { untouched: true });
  const pending = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValue(pending.promise);
  render(tree());
  await screen.findByRole("region", { name: "Saved order" });
  await act(async () => {
    pending.reject(new TypeError("offline"));
    await pending.promise.catch(() => undefined);
  });
  await waitFor(() => expect(last.isError).toBe(true));
  expect(screen.getByRole("region", { name: "Saved order" })).toBeVisible();
  const denied = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValue(denied.promise);
  const authority = captureDeviceReadAuthority();
  let refresh: Promise<unknown>;
  act(() => {
    refresh = last.refetch();
  });
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
  await act(async () => {
    denied.reject({ data: { code: "NOT_FOUND" } });
    await refresh!;
  });
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull(),
  );
  expect(captureDeviceReadAuthority()).toBe(authority);
  expect(await store.readSnapshotWithAuthority(other)).toEqual({
    untouched: true,
  });
  const token = await store.captureSnapshotAuthority(
    `receiving-order:${orderId}`,
  );
  await waitFor(async () =>
    expect(await store.readSnapshotWithAuthority(token)).toBeNull(),
  );
});
it("rejects late HTTP publication and persistence when the selected order changes", async () => {
  const { store, token } = await saved();
  const pending = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValue(pending.promise);
  const view = render(tree());
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  view.rerender(tree("33333333-3333-4333-8333-333333333333"));
  await act(async () => {
    pending.resolve(live("LATE"));
    await pending.promise;
  });
  expect(screen.queryByText("LATE")).toBeNull();
  expect(await store.readSnapshotWithAuthority(token)).toMatchObject({
    orderNumber: "SAVED",
  });
});

it("falls back to the real read when cache capture fails without persisting that response", async () => {
  const { store, token } = await saved();
  const capture = vi
    .spyOn(store, "captureSnapshotAuthority")
    .mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
  const existing = vi
    .spyOn(store, "captureExistingSnapshotAuthority")
    .mockRejectedValue(new Error("Storage unavailable"));
  state.rpc.mockResolvedValue(live("NETWORK"));
  render(tree());
  await waitFor(() =>
    expect(screen.getByLabelText("Live order")).toHaveTextContent("NETWORK"),
  );
  expect(state.rpc).toHaveBeenCalledOnce();
  expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull();
  capture.mockRestore();
  existing.mockRestore();
  expect(await store.readSnapshotWithAuthority(token)).toMatchObject({
    orderNumber: "SAVED",
  });
});
it("rejects a pending HTTP success after a missed cross-context key revocation", async () => {
  const { store, token } = await saved();
  const pending = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValue(pending.promise);
  render(tree());
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  // Separate module stays bound; mock localStorage emits no storage events.
  // Suppress same-tab notification too to exercise persisted authority alone.
  vi.resetModules();
  const other = await import("~/lib/drawing-offline");
  await other.setDrawingOfflineAccount("org:reader");
  const another = new other.DrawingOfflineStore("org:reader"),
    foreign = await another.captureSnapshotAuthority(
      `receiving-order:${orderId}`,
    );
  const dispatch = vi
    .spyOn(window, "dispatchEvent")
    .mockImplementation(() => true);
  await another.revokeSnapshot(foreign);
  dispatch.mockRestore();
  await act(async () => {
    pending.resolve(live("STALE HTTP"));
    await pending.promise;
  });
  await waitFor(() => expect(last.isError).toBe(true));
  expect(screen.getByLabelText("Live order")).toHaveTextContent(
    "no live order",
  );
  expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull();
  await expect(store.readSnapshotWithAuthority(token)).rejects.toThrow();
  const fresh = await another.captureSnapshotAuthority(
    `receiving-order:${orderId}`,
  );
  expect(await another.readSnapshotWithAuthority(fresh)).toBeNull();
  await other.setDrawingOfflineAccount(null);
});
it("a notes-only404 revokes a previous saved reading before verification returns", async () => {
  const { store } = await saved();
  const pending = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValue(pending.promise);
  render(tree(orderId, false));
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull();
  await act(async () => {
    pending.reject({ data: { code: "NOT_FOUND" } });
    await pending.promise.catch(() => undefined);
  });
  await waitFor(() => expect(last.isError).toBe(true));
  const newRead = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValue(newRead.promise);
  cleanup();
  client.clear();
  render(tree());
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull();
  const after = await store.captureSnapshotAuthority(
    `receiving-order:${orderId}`,
  );
  expect(await store.readSnapshotWithAuthority(after)).toBeNull();
});
it("late A response cannot publish or save after A to B to A returns", async () => {
  await saved();
  const first = deferred<ReturnType<typeof live>>(),
    second = deferred<ReturnType<typeof live>>(),
    third = deferred<ReturnType<typeof live>>();
  state.rpc
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise);
  const view = render(tree());
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
  async function switchTo(key: string) {
    await cache.stop();
    await setDrawingOfflineAccount(key);
    state.account = {
      accountKey: key,
      userId: key,
      organizationId: "org",
      store: new DrawingOfflineStore(key),
    };
    cache = startDeviceQueryCache(client, key);
    await cache.ready;
    view.rerender(tree());
  }
  await act(async () => {
    await switchTo("org:other");
  });
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
  await act(async () => {
    await switchTo("org:reader");
  });
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(3));
  await act(async () => {
    first.resolve(live("OLD A"));
    second.resolve(live("OLD B"));
    await Promise.all([first.promise, second.promise]);
  });
  expect(screen.queryByText("OLD A")).toBeNull();
  expect(screen.queryByText("OLD B")).toBeNull();
  await act(async () => {
    third.resolve(live("CURRENT A"));
    await third.promise;
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Live order")).toHaveTextContent("CURRENT A"),
  );
});
it("manual query updates cannot create a saved projection", async () => {
  const store = state.account!.store as DrawingOfflineStore;
  const pending = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValue(pending.promise);
  render(tree());
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  act(() => {
    client.setQueryData(
      [["materialList", "getOrderById"], { input: { orderId }, type: "query" }],
      live("OPTIMISTIC"),
    );
  });
  const token = await store.captureSnapshotAuthority(
    `receiving-order:${orderId}`,
  );
  expect(await store.readSnapshotWithAuthority(token)).toBeNull();
});

it("waits for a pending header but allows loaded unassigned live verification without a projection", async () => {
  state.rpc.mockResolvedValue({ ...live("UNASSIGNED"), jobId: null });
  const view = render(
    <QueryClientProvider client={client}>
      <Screen headerReady={false} jobId={null} />
    </QueryClientProvider>,
  );
  expect(state.rpc).not.toHaveBeenCalled();
  view.rerender(
    <QueryClientProvider client={client}>
      <Screen headerReady jobId={null} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Live order")).toHaveTextContent("UNASSIGNED"),
  );
  expect(state.rpc).toHaveBeenCalledOnce();
  const store = state.account!.store as DrawingOfflineStore;
  const token = await store.captureSnapshotAuthority(
    `receiving-order:${orderId}`,
  );
  expect(await store.readSnapshotWithAuthority(token)).toBeNull();
});
it("does not cancel a notes-only read when irrelevant projection job metadata arrives", async () => {
  const pending = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValue(pending.promise);
  const view = render(
    <QueryClientProvider client={client}>
      <Screen saveReading={false} headerReady={false} jobId={null} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  view.rerender(
    <QueryClientProvider client={client}>
      <Screen saveReading={false} headerReady jobId="job" />
    </QueryClientProvider>,
  );
  await act(async () => {
    pending.resolve(live("NOTES"));
    await pending.promise;
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Live order")).toHaveTextContent("NOTES"),
  );
  expect(state.rpc).toHaveBeenCalledOnce();
});
it("cancels and refetches once for actual loaded job reassignment without publishing the old job response", async () => {
  const old = deferred<ReturnType<typeof live>>(),
    current = deferred<ReturnType<typeof live>>();
  state.rpc
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const view = render(
    <QueryClientProvider client={client}>
      <Screen jobId="job" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  view.rerender(
    <QueryClientProvider client={client}>
      <Screen jobId="new-job" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
  await act(async () => {
    old.resolve(live("OLD JOB"));
    await old.promise;
  });
  expect(screen.queryByText("OLD JOB")).toBeNull();
  await act(async () => {
    current.resolve({ ...live("NEW JOB"), jobId: "new-job" });
    await current.promise;
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Live order")).toHaveTextContent("NEW JOB"),
  );
  expect(state.rpc).toHaveBeenCalledTimes(2);
});

it("uses readonly existing-key capture before HTTP when registration fails, then persists denial safely", async () => {
  const { store, token } = await saved();
  const capture = vi
    .spyOn(store, "captureSnapshotAuthority")
    .mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
  const fallback = vi.spyOn(store, "captureExistingSnapshotAuthority");
  const pending = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValue(pending.promise);
  render(tree());
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  expect(fallback).toHaveBeenCalled();
  await act(async () => {
    pending.reject({ data: { code: "NOT_FOUND" } });
    await pending.promise.catch(() => undefined);
  });
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull(),
  );
  await waitFor(async () => {
    await expect(store.readSnapshotWithAuthority(token)).rejects.toThrow();
  });
  capture.mockRestore();
  fallback.mockRestore();
});
it("keeps real HTTP available without minting a fallback epoch for a missing key", async () => {
  const store = state.account!.store as DrawingOfflineStore;
  const capture = vi
    .spyOn(store, "captureSnapshotAuthority")
    .mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
  state.rpc.mockResolvedValue(live("UNCACHED"));
  render(tree());
  await waitFor(() =>
    expect(screen.getByLabelText("Live order")).toHaveTextContent("UNCACHED"),
  );
  expect(
    await store.captureExistingSnapshotAuthority(`receiving-order:${orderId}`),
  ).toBeNull();
  expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull();
  capture.mockRestore();
});

it("aliases two consumers and closing verification cannot cancel or overwrite the new notes attempt", async () => {
  const store = state.account!.store as DrawingOfflineStore;
  const old = deferred<ReturnType<typeof live>>(),
    notes = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(notes.promise);
  function Both({ verifying }: { verifying: boolean }) {
    const reads = useReceivingOrderReads({
      verificationOrderId: verifying ? orderId : null,
      notesOrderId: orderId,
      materialListId: listId,
      jobId: "job",
      headerReady: true,
    });
    return (
      <>
        <output aria-label="Verification result">
          {reads.verification.data?.orderNumber ?? "none"}
        </output>
        <output aria-label="Notes result">
          {reads.notes.data?.orderNumber ?? "none"}
        </output>
      </>
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Both verifying />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  view.rerender(
    <QueryClientProvider client={client}>
      <Both verifying={false} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
  await act(async () => {
    old.resolve(live("OLD VERIFICATION"));
    await old.promise;
  });
  expect(screen.getByLabelText("Notes result")).toHaveTextContent("none");
  await act(async () => {
    notes.resolve(live("CURRENT NOTES"));
    await notes.promise;
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Notes result")).toHaveTextContent(
      "CURRENT NOTES",
    ),
  );
  expect(screen.getByLabelText("Verification result")).toHaveTextContent(
    "none",
  );
  expect(state.rpc).toHaveBeenCalledTimes(2);
  const token = await store.captureSnapshotAuthority(
    `receiving-order:${orderId}`,
  );
  expect(await store.readSnapshotWithAuthority(token)).toBeNull();
});

it("a delayed saved disk result cannot resurrect after404 or reconnect before new HTTP settles", async () => {
  const { store } = await saved();
  const disk = deferred<unknown>(),
    first = deferred<ReturnType<typeof live>>(),
    afterReconnect = deferred<ReturnType<typeof live>>();
  const originalRead = store.readSnapshotWithAuthority.bind(store);
  const spy = vi
    .spyOn(store, "readSnapshotWithAuthority")
    .mockImplementationOnce(
      async <T,>(token: SnapshotAuthority): Promise<T | null> => {
        const value = await originalRead<T>(token);
        await disk.promise;
        return value;
      },
    );
  state.rpc
    .mockReturnValueOnce(first.promise)
    .mockReturnValue(afterReconnect.promise);
  render(tree());
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  await act(async () => {
    first.reject({ data: { code: "NOT_FOUND" } });
    await first.promise.catch(() => undefined);
  });
  await waitFor(() => expect(last.isError).toBe(true));
  await act(async () => {
    disk.resolve(null);
    await disk.promise;
  });
  expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull();
  act(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    window.dispatchEvent(new Event("offline"));
  });
  act(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event("online"));
  });
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull();
  spy.mockRestore();
});

it("a canceled verifier404 cannot revoke the newer notes attempt's same-key snapshot", async () => {
  const { store, token } = await saved();
  const old = deferred<ReturnType<typeof live>>(),
    current = deferred<ReturnType<typeof live>>();
  state.rpc
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  function Both({ verifying }: { verifying: boolean }) {
    const reads = useReceivingOrderReads({
      verificationOrderId: verifying ? orderId : null,
      notesOrderId: orderId,
      materialListId: listId,
      jobId: "job",
      headerReady: true,
    });
    return (
      <output aria-label="Notes current">
        {reads.notes.data?.orderNumber ?? "none"}
      </output>
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Both verifying />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  view.rerender(
    <QueryClientProvider client={client}>
      <Both verifying={false} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
  await act(async () => {
    current.resolve(live("NOTES ACK"));
    await current.promise;
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Notes current")).toHaveTextContent(
      "NOTES ACK",
    ),
  );
  await act(async () => {
    old.reject({ data: { code: "NOT_FOUND" } });
    await old.promise.catch(() => undefined);
  });
  expect(screen.getByLabelText("Notes current")).toHaveTextContent("NOTES ACK");
  expect(await store.readSnapshotWithAuthority(token)).toMatchObject({
    orderNumber: "SAVED",
  });
});

it("a missed persisted account revocation in readonly fallback fails closed before HTTP", async () => {
  const { store, token } = await saved();
  const blocked = deferred<SnapshotAuthority>();
  const capture = vi
    .spyOn(store, "captureSnapshotAuthority")
    .mockReturnValue(blocked.promise);
  client.setQueryData(
    [["materialList", "getOrderById"], { input: { orderId }, type: "query" }],
    live("CACHED A"),
  );
  render(tree());
  await waitFor(() => expect(capture).toHaveBeenCalled());
  expect(state.rpc).not.toHaveBeenCalled();
  vi.resetModules();
  const other = await import("~/lib/drawing-offline");
  await other.setDrawingOfflineAccount("org:reader");
  await new other.DrawingOfflineStore("org:reader").clear();
  await act(async () => {
    blocked.reject(
      new DOMException("registration quota", "QuotaExceededError"),
    );
    await blocked.promise.catch(() => undefined);
  });
  await waitFor(() => expect(last.isError).toBe(true));
  expect(state.rpc).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Live order")).toHaveTextContent(
    "no live order",
  );
  expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull();
  await expect(store.readSnapshotWithAuthority(token)).rejects.toThrow();
  capture.mockRestore();
  await other.setDrawingOfflineAccount(null);
});
it("the exact expected-account conflict hides cached raw and saved A without purging either account", async () => {
  const { store, token } = await saved();
  const authority = captureDeviceReadAuthority();
  client.setQueryData(
    [["materialList", "getOrderById"], { input: { orderId }, type: "query" }],
    live("CACHED A"),
  );
  const pending = deferred<ReturnType<typeof live>>();
  state.rpc.mockReturnValue(pending.promise);
  render(tree());
  expect(screen.getByLabelText("Live order")).toHaveTextContent("CACHED A");
  await waitFor(() => expect(state.rpc).toHaveBeenCalledOnce());
  await act(async () => {
    pending.reject(
      Object.assign(new Error(RECEIVING_ACCOUNT_CHANGED_MESSAGE), {
        data: { code: "CONFLICT" },
      }),
    );
    await pending.promise.catch(() => undefined);
  });
  await waitFor(() => expect(last.isError).toBe(true));
  expect(screen.getByLabelText("Live order")).toHaveTextContent(
    "no live order",
  );
  expect(screen.queryByRole("region", { name: "Saved order" })).toBeNull();
  expect(captureDeviceReadAuthority()).toBe(authority);
  expect(await store.readSnapshotWithAuthority(token)).toMatchObject({
    orderNumber: "SAVED",
  });
});
