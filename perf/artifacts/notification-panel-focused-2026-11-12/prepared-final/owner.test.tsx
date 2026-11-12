import { Activity, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNotificationAccount } from "~/hooks/use-notification-account";
const mock = vi.hoisted(() => ({
  online: true,
  simulation: null as null | { id: string },
  identity: vi.fn(),
  overview: vi.fn(),
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => mock.online,
  getBrowserOnlineStatus: () => mock.online,
}));
vi.mock("~/components/simulation/SimulationProvider", () => ({
  useEmployeeSimulation: () => mock.simulation,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    notifications: {
      identity: { _def: () => ({ path: ["notifications", "identity"] }) },
      overview: { _def: () => ({ path: ["notifications", "overview"] }) },
    },
    useUtils: () => ({
      client: {
        notifications: {
          identity: { query: mock.identity },
          overview: { query: mock.overview },
        },
      },
    }),
  },
}));
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  mock.online = true;
  mock.simulation = null;
  mock.identity.mockReset().mockResolvedValue({ accountKey: "a:org" });
  mock.overview
    .mockReset()
    .mockImplementation(async (input: { accountKey: string }) => ({
      accountKey: input.accountKey,
      unreadCount: 2,
      readTargets: [],
    }));
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
});
it("boots through actual identity HTTP, then overview suppresses only the identity interval while preserving the binding", async () => {
  const { wrapper, client } = setup();
  const { result } = renderHook(() => useNotificationAccount("a"), { wrapper });
  await waitFor(() => expect(result.current.overview.isSuccess).toBe(true));
  expect(result.current.accountKey).toBe("a:org");
  const identity = client.getQueryCache().find({
    queryKey: [
      ["notifications", "identity"],
      { input: { sessionKey: "a" }, type: "query" },
    ],
  });
  expect(identity?.isActive()).toBe(true);
  expect(identity?.observers[0]?.options.refetchInterval).toBe(false);
  await act(async () => {
    await result.current.overview.refetch();
  });
  expect(result.current.accountKey).toBe("a:org");
  expect(mock.identity).toHaveBeenCalledOnce();
});
it("manual cached overview cannot establish ownership before a real reply", async () => {
  const { wrapper, client } = setup();
  const reply = deferred<{
    accountKey: string;
    unreadCount: number;
    readTargets: [];
  }>();
  mock.overview.mockReturnValue(reply.promise);
  client.setQueryData(
    [
      ["notifications", "overview"],
      { input: { accountKey: "a:org" }, type: "query" },
    ],
    { accountKey: "a:org", unreadCount: 99, readTargets: [] },
  );
  const { result } = renderHook(() => useNotificationAccount("a"), { wrapper });
  await waitFor(() => expect(mock.overview).toHaveBeenCalledOnce());
  const identity = client.getQueryCache().find({
    queryKey: [
      ["notifications", "identity"],
      { input: { sessionKey: "a" }, type: "query" },
    ],
  });
  expect(identity?.observers[0]?.options.refetchInterval).toBe(30_000);
  await act(async () =>
    reply.resolve({ accountKey: "a:org", unreadCount: 1, readTargets: [] }),
  );
  await waitFor(() =>
    expect(identity?.observers[0]?.options.refetchInterval).toBe(false),
  );
  expect(result.current.accountKey).toBe("a:org");
});
it("transient overview failure restores identity catchup without an overview retry loop", async () => {
  const { wrapper } = setup();
  const { result } = renderHook(() => useNotificationAccount("a"), { wrapper });
  await waitFor(() => expect(result.current.overview.isSuccess).toBe(true));
  mock.overview.mockRejectedValueOnce(new Error("network unavailable"));
  await act(async () => {
    await result.current.overview.refetch();
  });
  await waitFor(() => expect(mock.identity).toHaveBeenCalledTimes(2));
  expect(result.current.accountKey).toBe("a:org");
  expect(mock.overview).toHaveBeenCalledTimes(2);
});
it("a new same-key owner gets fresh HTTP after an old deduplicated request settles", async () => {
  const { wrapper } = setup();
  const old = deferred<{ accountKey: string }>();
  mock.identity.mockReturnValueOnce(old.promise);
  const first = renderHook(() => useNotificationAccount("a"), { wrapper });
  await waitFor(() => expect(mock.identity).toHaveBeenCalledOnce());
  first.unmount();
  const second = renderHook(() => useNotificationAccount("a"), { wrapper });
  await act(async () => old.resolve({ accountKey: "old:org" }));
  await waitFor(() => expect(second.result.current.accountKey).toBe("a:org"));
  expect(mock.identity.mock.calls.length).toBeGreaterThanOrEqual(2);
});
it("simulation replacement cannot reuse a previous successful overview as authority", async () => {
  const { wrapper } = setup();
  const { result, rerender } = renderHook(() => useNotificationAccount("a"), {
    wrapper,
  });
  await waitFor(() => expect(result.current.overview.isSuccess).toBe(true));
  const next = deferred<{ accountKey: string }>();
  mock.identity.mockReturnValueOnce(next.promise);
  mock.simulation = { id: "another-simulation" };
  rerender();
  await waitFor(() => expect(mock.identity).toHaveBeenCalledTimes(2));
  expect(result.current.accountKey).toBeNull();
  await act(async () => next.resolve({ accountKey: "a:org" }));
  await waitFor(() => expect(result.current.accountKey).toBe("a:org"));
});
it("Activity reactivation requires fresh identity and ignores the old pending completion", async () => {
  const { client } = setup();
  const pending = deferred<{
    accountKey: string;
    unreadCount: number;
    readTargets: [];
  }>();
  mock.overview.mockReturnValueOnce(pending.promise);
  let mode: "visible" | "hidden" = "visible";
  const hook = renderHook(() => useNotificationAccount("a"), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <Activity mode={mode}>{children}</Activity>
      </QueryClientProvider>
    ),
  });
  await waitFor(() => expect(mock.overview).toHaveBeenCalledOnce());
  mode = "hidden";
  hook.rerender();
  mode = "visible";
  hook.rerender();
  await act(async () =>
    pending.resolve({ accountKey: "a:org", unreadCount: 100, readTargets: [] }),
  );
  await waitFor(() =>
    expect(mock.identity.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  await waitFor(() => expect(hook.result.current.accountKey).toBe("a:org"));
});
it("retains the same bound account across a benign offline interval and waits for fresh ownership", async () => {
  const { wrapper, client } = setup();
  const hook = renderHook(() => useNotificationAccount("a"), { wrapper });
  await waitFor(() =>
    expect(hook.result.current.overview.isSuccess).toBe(true),
  );
  mock.online = false;
  hook.rerender();
  expect(hook.result.current.accountKey).toBe("a:org");
  const fresh = deferred<{ accountKey: string }>();
  mock.identity.mockReturnValueOnce(fresh.promise);
  mock.online = true;
  hook.rerender();
  await waitFor(() => expect(mock.identity).toHaveBeenCalledTimes(2));
  expect(hook.result.current.accountKey).toBe("a:org");
  const identity = client.getQueryCache().find({
    queryKey: [
      ["notifications", "identity"],
      { input: { sessionKey: "a" }, type: "query" },
    ],
  });
  expect(identity?.observers[0]?.options.refetchInterval).toBe(30_000);
  await act(async () => fresh.resolve({ accountKey: "a:org" }));
  expect(hook.result.current.accountKey).toBe("a:org");
});
it("does not let an older identity reply undo a terminal overview denial", async () => {
  const { wrapper } = setup();
  const hook = renderHook(() => useNotificationAccount("a"), { wrapper });
  await waitFor(() =>
    expect(hook.result.current.overview.isSuccess).toBe(true),
  );
  const old = deferred<{ accountKey: string }>(),
    fresh = deferred<{ accountKey: string }>();
  mock.identity
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise);
  let identityRead!: Promise<unknown>;
  act(() => {
    identityRead = hook.result.current.identity.refetch();
  });
  await waitFor(() => expect(mock.identity).toHaveBeenCalledTimes(2));
  mock.overview.mockRejectedValueOnce(
    Object.assign(new Error("account changed"), { data: { code: "CONFLICT" } }),
  );
  await act(async () => {
    await hook.result.current.overview.refetch();
  });
  expect(hook.result.current.accountKey).toBeNull();
  await act(async () => {
    old.resolve({ accountKey: "a:org" });
    await identityRead;
  });
  await waitFor(() => expect(mock.identity).toHaveBeenCalledTimes(3));
  expect(hook.result.current.accountKey).toBeNull();
  await act(async () => fresh.resolve({ accountKey: "b:org" }));
  await waitFor(() => expect(hook.result.current.accountKey).toBe("b:org"));
});
it("two delayed 30-second overview cycles suppress only interval identity traffic", async () => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "performance",
    ],
  });
  const { wrapper, client } = setup();
  mock.overview.mockImplementation(
    ({ accountKey }: { accountKey: string }) =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ accountKey, unreadCount: 2, readTargets: [] }),
          250,
        ),
      ),
  );
  const hook = renderHook(() => useNotificationAccount("a"), { wrapper });
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  await advance(1);
  await advance(250);
  await advance(1);
  expect(hook.result.current.accountKey).toBe("a:org");
  expect(mock.identity).toHaveBeenCalledOnce();
  expect(mock.overview).toHaveBeenCalledOnce();
  await advance(30_000);
  await advance(250);
  await advance(1);
  expect(mock.overview).toHaveBeenCalledTimes(2);
  expect(mock.identity).toHaveBeenCalledOnce();
  await advance(30_000);
  await advance(250);
  await advance(1);
  expect(mock.overview).toHaveBeenCalledTimes(3);
  expect(mock.identity).toHaveBeenCalledOnce();
  // An explicit invalidation remains effective even while interval traffic is off.
  await act(async () => {
    await client.invalidateQueries({
      queryKey: [["notifications", "identity"]],
    });
  });
  expect(mock.identity).toHaveBeenCalledTimes(2);
  expect(hook.result.current.accountKey).toBe("a:org");
});
it("hydrated or manually replaced identity data never opens an inbox without actual HTTP", async () => {
  const { wrapper, client } = setup();
  const seed = new QueryClient();
  const key = [
    ["notifications", "identity"],
    { input: { sessionKey: "a" }, type: "query" },
  ];
  seed.setQueryData(key, { accountKey: "cached:org" });
  hydrate(client, dehydrate(seed));
  seed.clear();
  const reply = deferred<{ accountKey: string }>();
  mock.identity.mockReturnValue(reply.promise);
  const hook = renderHook(() => useNotificationAccount("a"), { wrapper });
  await waitFor(() => expect(mock.identity).toHaveBeenCalledOnce());
  act(() => {
    client.setQueryData(key, { accountKey: "manual:org" });
  });
  expect(hook.result.current.accountKey).toBeNull();
  expect(mock.overview).not.toHaveBeenCalled();
  await act(async () => reply.resolve({ accountKey: "a:org" }));
  await waitFor(() => expect(hook.result.current.accountKey).toBe("a:org"));
});
it("same retained instance A to B to A rejects the first A overview completion", async () => {
  const { wrapper } = setup();
  const old = deferred<{
    accountKey: string;
    unreadCount: number;
    readTargets: [];
  }>();
  mock.identity.mockImplementation(
    async ({ sessionKey }: { sessionKey: string }) => ({
      accountKey: `${sessionKey}:org`,
    }),
  );
  mock.overview.mockReturnValueOnce(old.promise);
  const hook = renderHook(({ session }) => useNotificationAccount(session), {
    initialProps: { session: "a" },
    wrapper,
  });
  await waitFor(() => expect(mock.overview).toHaveBeenCalledOnce());
  hook.rerender({ session: "b" });
  await waitFor(() => expect(hook.result.current.accountKey).toBe("b:org"));
  hook.rerender({ session: "a" });
  await waitFor(() => expect(hook.result.current.accountKey).toBe("a:org"));
  await act(async () =>
    old.resolve({ accountKey: "a:org", unreadCount: 999, readTargets: [] }),
  );
  await waitFor(() =>
    expect(hook.result.current.overview.data?.unreadCount).toBe(2),
  );
});
it("a terminal overview refusal recovers identity once without an immediate refusal loop", async () => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "performance",
    ],
  });
  const { wrapper } = setup();
  mock.overview.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  renderHook(() => useNotificationAccount("a"), { wrapper });
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  expect(mock.overview).toHaveBeenCalledOnce();
  expect(mock.identity).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(mock.overview).toHaveBeenCalledOnce();
  expect(mock.identity).toHaveBeenCalledTimes(2);
});
it("an overview started before explicit identity refresh cannot borrow the newer receipt", async () => {
  const { wrapper, client } = setup();
  const old = deferred<{
    accountKey: string;
    unreadCount: number;
    readTargets: [];
  }>();
  const fresh = deferred<{
    accountKey: string;
    unreadCount: number;
    readTargets: [];
  }>();
  mock.overview
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise);
  const hook = renderHook(() => useNotificationAccount("a"), { wrapper });
  await waitFor(() => expect(mock.overview).toHaveBeenCalledOnce());
  act(() => hook.result.current.refreshIdentity());
  await waitFor(() => expect(mock.identity).toHaveBeenCalledTimes(2));
  await act(async () =>
    old.resolve({ accountKey: "a:org", unreadCount: 999, readTargets: [] }),
  );
  await waitFor(() => expect(mock.overview).toHaveBeenCalledTimes(2));
  const identity = client
    .getQueryCache()
    .find({
      queryKey: [
        ["notifications", "identity"],
        { input: { sessionKey: "a" }, type: "query" },
      ],
    });
  expect(identity?.observers[0]?.options.refetchInterval).toBe(30_000);
  expect(hook.result.current.overview.data?.unreadCount).not.toBe(999);
  await act(async () =>
    fresh.resolve({ accountKey: "a:org", unreadCount: 2, readTargets: [] }),
  );
  await waitFor(() =>
    expect(identity?.observers[0]?.options.refetchInterval).toBe(false),
  );
});
