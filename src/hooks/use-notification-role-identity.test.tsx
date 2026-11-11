import { act, cleanup, renderHook } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNotificationRoleIdentity } from "./use-notification-role-identity";
import { setAppPageActive } from "~/lib/app-page-activity";
const state = vi.hoisted(() => ({
  authority: {} as object,
  account: { userId: "user", organizationId: "org" } as {
    userId: string;
    organizationId: string;
  } | null,
}));
vi.mock("~/lib/device-query-cache", () => ({
  captureDeviceReadAuthority: () => state.authority,
}));
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({
  useDrawingAccount: () => state.account,
}));
vi.mock("~/components/simulation/SimulationProvider", () => ({
  useEmployeeSimulation: () => null,
}));
vi.mock("~/lib/employee-simulation", () => ({
  simulationViewHeaders: () => ({ view: "user" }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    user: { getMyRole: { key: "role" } },
    notifications: { identity: { key: "identity" } },
  },
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (proc: { key: string }, input: unknown) => [
    proc.key,
    input ?? null,
  ],
}));
const roleKey = ["role", null];
const identityKey = ["identity", { sessionKey: "user" }];
const role = (accountKey: string | null = "user:org") => ({
  notificationIdentity: {
    accountKey,
    userId: "user",
    organizationId: "org",
    actorId: "user",
    simulationId: null,
  },
});
let client: QueryClient;
const stops: (() => void)[] = [];
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function setup() {
  return renderHook(() => useNotificationRoleIdentity("user", true), {
    wrapper: Wrapper,
  });
}
function owner(enabled = true) {
  const observer = new QueryObserver(client, {
    queryKey: roleKey,
    enabled,
    staleTime: Infinity,
    queryFn: async () => role(),
  });
  stops.push(observer.subscribe(() => undefined));
  return observer;
}
async function read(key: unknown[], data: unknown) {
  await act(async () => {
    await client.fetchQuery({
      queryKey: key,
      staleTime: 0,
      queryFn: async () => data,
    });
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  state.account = { userId: "user", organizationId: "org" };
  state.authority = {};
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  setAppPageActive(true);
});
afterEach(() => {
  cleanup();
  stops.splice(0).forEach((stop) => stop());
  client.clear();
  vi.useRealTimers();
});
it("adds no role observer and requires a post-mount nonmanual fetch", async () => {
  client.setQueryData(roleKey, role());
  owner();
  const { result } = setup();
  expect(result.current.shared).toBe(false);
  expect(
    client.getQueryCache().find({ queryKey: roleKey })?.getObserversCount(),
  ).toBe(1);
  act(() => {
    client.setQueryData(roleKey, role());
  });
  expect(result.current.shared).toBe(false);
  await read(roleKey, role());
  expect(result.current.shared).toBe(true);
});
it("uses standalone outside the account provider and never certifies a disabled owner", async () => {
  state.account = null;
  owner(false);
  const { result } = setup();
  await read(roleKey, role());
  expect(result.current.shared).toBe(false);
  await read(identityKey, { accountKey: "user:org" });
  expect(result.current.accountKey).toBe("user:org");
  expect(result.current.shared).toBe(false);
});
it("does not mistake a disabled observer for an enabled role owner", async () => {
  owner(false);
  const { result } = setup();
  await read(roleKey, role());
  expect(result.current.shared).toBe(false);
});
it("certifies null and expires from request start without resurrecting old standalone data", async () => {
  client.setQueryData(roleKey, role());
  owner();
  const { result } = setup();
  await read(identityKey, { accountKey: "old" });
  await read(roleKey, role(null));
  expect(result.current.shared).toBe(true);
  expect(result.current.accountKey).toBeNull();
  expect(result.current.verified).toBe(true);
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(result.current.verified).toBe(false);
  await read(identityKey, { accountKey: "new" });
  expect(result.current.accountKey).toBe("new");
});
it("drops authority on owner disable, error and explicit recovery", async () => {
  client.setQueryData(roleKey, role());
  const observer = owner();
  const { result } = setup();
  await read(roleKey, role());
  act(() => {
    observer.setOptions({ queryKey: roleKey, enabled: false });
  });
  expect(result.current.shared).toBe(false);
  await read(identityKey, { accountKey: "user:org" });
  expect(result.current.verified).toBe(true);
  act(() => {
    result.current.reset();
  });
  expect(result.current.verified).toBe(false);
});
it("rejects an in-flight result from an earlier actor generation", async () => {
  client.setQueryData(roleKey, role());
  owner();
  const { result, rerender } = setup();
  let finish!: (data: ReturnType<typeof role>) => void;
  let request!: Promise<unknown>;
  act(() => {
    request = client.fetchQuery({
      queryKey: roleKey,
      staleTime: 0,
      queryFn: () =>
        new Promise<ReturnType<typeof role>>((resolve) => {
          finish = resolve;
        }),
    });
  });
  state.authority = {};
  rerender();
  await act(async () => {
    finish(role());
    await request;
  });
  expect(result.current.verified).toBe(false);
});

it("does not renew a stalled request for 30 seconds from its eventual completion", async () => {
  client.setQueryData(roleKey, role());
  owner();
  const { result } = setup();
  let finish!: (data: ReturnType<typeof role>) => void;
  let request!: Promise<unknown>;
  act(() => {
    request = client.fetchQuery({
      queryKey: roleKey,
      staleTime: 0,
      queryFn: () =>
        new Promise<ReturnType<typeof role>>((resolve) => {
          finish = resolve;
        }),
    });
  });
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  await act(async () => {
    finish(role());
    await request;
  });
  expect(result.current.shared).toBe(false);
});
it("rejects changed actor or organization even if the notification key looks plausible", async () => {
  client.setQueryData(roleKey, role());
  owner();
  const { result } = setup();
  await read(roleKey, {
    notificationIdentity: { ...role().notificationIdentity, actorId: "other" },
  });
  expect(result.current.shared).toBe(false);
  await read(roleKey, {
    notificationIdentity: {
      ...role().notificationIdentity,
      organizationId: "other",
    },
  });
  expect(result.current.shared).toBe(false);
});

function standalone(read: () => Promise<unknown>) {
  const observer = new QueryObserver(client, {
    queryKey: identityKey,
    queryFn: read,
    staleTime: Infinity,
    initialData: { accountKey: "cached-untrusted" },
    enabled: true,
    retry: false,
  });
  stops.push(observer.subscribe(() => undefined));
  return observer;
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
it("recovers standalone authority once on hidden/resume without enabling a new query", async () => {
  state.account = null;
  const fetch = vi.fn(async () => ({ accountKey: "user:org" }));
  const { result } = setup();
  standalone(fetch);
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.current.accountKey).toBe("user:org");
  act(() => {
    setAppPageActive(false);
  });
  await settle();
  expect(result.current.verified).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
  act(() => {
    setAppPageActive(true);
  });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.current.accountKey).toBe("user:org");
  expect(
    client.getQueryCache().find({ queryKey: identityKey })?.getObserversCount(),
  ).toBe(1);
});
it("recovers immediately when an inactive role owner invalidates an already-enabled fallback", async () => {
  client.setQueryData(roleKey, role());
  const roleOwner = owner(false);
  const fetch = vi.fn(async () => ({ accountKey: "user:org" }));
  const { result } = setup();
  standalone(fetch);
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  act(() => {
    roleOwner.setOptions({ queryKey: roleKey, enabled: false, staleTime: 123 });
  });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.current.verified).toBe(true);
});
it("does not spin retrying a failed standalone recovery", async () => {
  const fetch = vi.fn(async () => {
    throw new Error("offline transport");
  });
  const { result } = setup();
  standalone(fetch);
  await settle();
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.current.verified).toBe(false);
});
it("does not renew stale authority on an unrelated render before a throttled deadline runs", async () => {
  client.setQueryData(roleKey, role());
  owner();
  const { result, rerender } = setup();
  await read(roleKey, role());
  expect(result.current.shared).toBe(true);
  vi.setSystemTime(Date.now() + 30_001);
  rerender();
  expect(result.current.shared).toBe(false);
});

it("joins but cannot certify an old in-flight identity, then makes one fresh request after resume", async () => {
  state.account = null;
  let finish!: (value: { accountKey: string }) => void;
  const old = new Promise<{ accountKey: string }>((resolve) => {
    finish = resolve;
  });
  const fetch = vi
    .fn()
    .mockImplementationOnce(() => old)
    .mockResolvedValue({ accountKey: "fresh:org" });
  const observer = standalone(fetch);
  act(() => {
    void observer.refetch();
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const { result } = setup();
  await settle();
  act(() => {
    setAppPageActive(false);
  });
  act(() => {
    setAppPageActive(true);
  });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.current.verified).toBe(false);
  await act(async () => {
    finish({ accountKey: "old:org" });
    await old;
  });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.current.accountKey).toBe("fresh:org");
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("a joined old failure gets one fresh attempt, whose failure cannot spin", async () => {
  let reject!: (error: Error) => void;
  const old = new Promise<{ accountKey: string }>((_resolve, fail) => {
    reject = fail;
  });
  const fetch = vi
    .fn()
    .mockImplementationOnce(() => old)
    .mockRejectedValue(new Error("fresh transport failure"));
  const observer = standalone(fetch);
  act(() => {
    void observer.refetch();
  });
  const { result } = setup();
  await settle();
  await act(async () => {
    reject(new Error("old transport failure"));
    await old.catch(() => undefined);
  });
  await settle();
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.current.verified).toBe(false);
});

it("fresh malformed completions fail closed without spinning and later normal/manual HTTP can recover", async () => {
  const fetch = vi.fn<() => Promise<unknown>>().mockResolvedValue({});
  const { result } = setup();
  const observer = standalone(fetch);
  await settle();
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.current.verified).toBe(false);
  // This represents the existing interval's next HTTP attempt, not cache data.
  await act(async () => {
    await observer.refetch();
  });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.current.verified).toBe(false);
  fetch.mockResolvedValue({ accountKey: "fresh:org" });
  act(() => {
    result.current.reset();
  });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(result.current.accountKey).toBe("fresh:org");
  await settle();
  expect(fetch).toHaveBeenCalledTimes(3);
});
