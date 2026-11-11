import { act, cleanup, renderHook } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMaterialSortAuthority } from "./use-material-sort-authority";
import { setAppPageActive } from "~/lib/app-page-activity";
const state = vi.hoisted(() => ({ authority: {} as object }));
vi.mock("~/lib/device-query-cache", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  captureDeviceReadAuthority: () => state.authority,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    user: {
      getMyRole: { key: "role" },
      getMaterialSortPreferences: { key: "preferences" },
    },
  },
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (proc: { key: string }, input: unknown) => [
    proc.key,
    input ?? null,
  ],
}));
const input = { expectedUserId: "actor", expectedOrganizationId: "org" },
  roleKey = ["role", null],
  prefsKey = ["preferences", input];
const role = (
  scope = "org:actor",
  canEditExecutive = true,
  appAccess = true,
) => ({ accountScope: scope, canEditExecutive, appAccess });
let client: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  const [value] = useState(client);
  return <QueryClientProvider client={value}>{children}</QueryClientProvider>;
}
async function read(key: unknown[], data: unknown) {
  await act(async () => {
    await client.fetchQuery({
      queryKey: key,
      queryFn: async () => data,
      staleTime: 0,
    });
  });
}
function setup(healthy = true) {
  return renderHook(
    ({ account, ready, online }) =>
      useMaterialSortAuthority(account, online, ready, input),
    {
      wrapper: Wrapper,
      initialProps: { account: "org:actor", ready: healthy, online: true },
    },
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  state.authority = {};
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  setAppPageActive(true);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
});
it("adds no query or observer and cached/manual role data never grants a new scope", async () => {
  client.setQueryData(roleKey, role());
  const before = client.getQueryCache().getAll().length;
  const { result } = setup();
  expect(client.getQueryCache().getAll()).toHaveLength(before);
  expect(
    client.getQueryCache().find({ queryKey: roleKey })?.getObserversCount(),
  ).toBe(0);
  expect(result.current.editable).toBe(false);
  expect(result.current.suppressPoll).toBe(false);
  act(() => {
    client.setQueryData(roleKey, role());
  });
  expect(result.current.canEditExecutive).toBe(false);
  await read(roleKey, role());
  expect(result.current.canEditExecutive).toBe(true);
  expect(result.current.suppressPoll).toBe(true);
});
it("successful preference HTTP preserves permission/edit behavior during stream outage", async () => {
  const { result } = setup(false);
  await read(prefsKey, { canEditExecutive: true });
  expect(result.current.editable).toBe(true);
  expect(result.current.canEditExecutive).toBe(true);
  expect(result.current.suppressPoll).toBe(false);
});
it("latest successful HTTP can remove executive permission without preference writes", async () => {
  const { result } = setup();
  await read(prefsKey, { canEditExecutive: true });
  await read(roleKey, role("org:actor", false));
  expect(result.current.editable).toBe(true);
  expect(result.current.canEditExecutive).toBe(false);
  expect(result.current.suppressPoll).toBe(true);
});
it("terminal denial blocks stale settings and fresh role appAccess denial blocks editing", async () => {
  const { result } = setup();
  await read(roleKey, role());
  await act(async () => {
    await client
      .fetchQuery({
        queryKey: prefsKey,
        queryFn: async () => {
          throw Object.assign(new Error("denied"), {
            data: { code: "FORBIDDEN" },
          });
        },
      })
      .catch(() => undefined);
  });
  expect(result.current.editable).toBe(false);
  expect(result.current.suppressPoll).toBe(false);
  await read(roleKey, role("org:actor", false, false));
  expect(result.current.editable).toBe(false);
});
it("one freshness deadline restores fallback by60s without creating a role poll", async () => {
  const { result } = setup();
  await read(roleKey, role());
  expect(result.current.suppressPoll).toBe(true);
  void act(() => vi.advanceTimersByTime(59999));
  expect(result.current.suppressPoll).toBe(true);
  void act(() => vi.advanceTimersByTime(1));
  expect(result.current.suppressPoll).toBe(false);
  expect(result.current.editable).toBe(false);
  expect(
    client.getQueryCache().find({ queryKey: roleKey })?.getObserversCount(),
  ).toBe(0);
});
it("stream loss immediately restores fallback while current HTTP permissions remain", async () => {
  const { result, rerender } = setup();
  await read(roleKey, role());
  rerender({ account: "org:actor", ready: false, online: true });
  expect(result.current.suppressPoll).toBe(false);
  expect(result.current.canEditExecutive).toBe(true);
});
it("account/simulation changes and A→B→A cannot reuse cached success or late in-flight responses", async () => {
  const { result, rerender } = setup();
  let resolve!: (v: unknown) => void;
  let request!: Promise<unknown>;
  act(() => {
    request = client.fetchQuery({
      queryKey: roleKey,
      queryFn: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
  });
  rerender({ account: "org:other", ready: true, online: true });
  rerender({ account: "org:actor", ready: true, online: true });
  await act(async () => {
    resolve(role());
    await request;
  });
  expect(result.current.editable).toBe(false);
  await read(roleKey, role());
  expect(result.current.canEditExecutive).toBe(true);
  rerender({ account: "org:actor:simulation:s1", ready: true, online: true });
  expect(result.current.canEditExecutive).toBe(false);
  await read(roleKey, role("org:actor"));
  expect(result.current.editable).toBe(false);
  await read(roleKey, role("org:actor:simulation:s1", false));
  expect(result.current.editable).toBe(true);
  expect(result.current.canEditExecutive).toBe(false);
});
it("read-authority replacement cannot accept a late response", async () => {
  const { result, rerender } = setup();
  let resolve!: (v: unknown) => void;
  let request!: Promise<unknown>;
  act(() => {
    request = client.fetchQuery({
      queryKey: roleKey,
      queryFn: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
  });
  state.authority = {};
  rerender({ account: "org:actor", ready: true, online: true });
  await act(async () => {
    resolve(role());
    await request;
  });
  expect(result.current.editable).toBe(false);
});
it("hidden/offline pages drop authority listeners/deadlines and recompute real age on return", async () => {
  const { result, rerender } = setup();
  await read(roleKey, role());
  act(() => setAppPageActive(false));
  expect(result.current.suppressPoll).toBe(false);
  expect(result.current.editable).toBe(false);
  void act(() => vi.advanceTimersByTime(90000));
  act(() => setAppPageActive(true));
  expect(result.current.suppressPoll).toBe(false);
  expect(result.current.editable).toBe(false);
  await read(roleKey, role());
  expect(result.current.suppressPoll).toBe(true);
  rerender({ account: "org:actor", ready: true, online: false });
  expect(result.current.editable).toBe(false);
});
it("fallback catchup refetches only an already active preference key and never role", async () => {
  const prefs = vi.fn(async () => ({ canEditExecutive: true }));
  const { result, rerender } = renderHook(
    ({ ready }) => {
      const a = useMaterialSortAuthority("org:actor", true, ready, input);
      useQuery({ queryKey: prefsKey, queryFn: prefs, staleTime: Infinity });
      return a;
    },
    { wrapper: Wrapper, initialProps: { ready: true } },
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await read(roleKey, role());
  expect(result.current.suppressPoll).toBe(true);
  const before = prefs.mock.calls.length;
  rerender({ ready: false });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(prefs.mock.calls.length).toBe(before + 1);
  expect(
    client.getQueryCache().find({ queryKey: roleKey })?.getObserversCount(),
  ).toBe(0);
});

it("query eviction revokes the certificate and resumes fallback", async () => {
  const { result } = setup();
  await read(roleKey, role());
  expect(result.current.suppressPoll).toBe(true);
  act(() => client.removeQueries({ queryKey: roleKey, exact: true }));
  expect(result.current.suppressPoll).toBe(false);
  expect(result.current.editable).toBe(false);
});
it("fresh post-resume role response wins over newer pre-hide preference authority", async () => {
  const { result } = setup();
  await read(roleKey, role());
  await read(prefsKey, { canEditExecutive: true });
  act(() => setAppPageActive(false));
  act(() => setAppPageActive(true));
  await read(roleKey, role("org:actor", false));
  expect(result.current.canEditExecutive).toBe(false);
});

it("an older preference request cannot override a newer role revocation", async () => {
  const { result } = setup();
  let resolve!: (value: unknown) => void;
  let request!: Promise<unknown>;
  act(() => {
    request = client.fetchQuery({
      queryKey: prefsKey,
      queryFn: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
  });
  await read(roleKey, role("org:actor", false, false));
  expect(result.current.editable).toBe(false);
  await act(async () => {
    resolve({ canEditExecutive: true });
    await request;
  });
  expect(result.current.editable).toBe(false);
  expect(result.current.canEditExecutive).toBe(false);
});
it("a response at60seconds cannot renew authority for another minute", async () => {
  const { result } = setup();
  let resolve!: (value: unknown) => void;
  let request!: Promise<unknown>;
  act(() => {
    request = client.fetchQuery({
      queryKey: roleKey,
      queryFn: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
  });
  void act(() => vi.advanceTimersByTime(60000));
  await act(async () => {
    resolve(role());
    await request;
  });
  expect(result.current.editable).toBe(false);
  expect(result.current.suppressPoll).toBe(false);
});
it("a slow accepted response expires by request start rather than completion", async () => {
  const { result } = setup();
  let resolve!: (value: unknown) => void;
  let request!: Promise<unknown>;
  act(() => {
    request = client.fetchQuery({
      queryKey: roleKey,
      queryFn: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
  });
  void act(() => vi.advanceTimersByTime(40000));
  await act(async () => {
    resolve(role());
    await request;
  });
  expect(result.current.suppressPoll).toBe(true);
  void act(() => vi.advanceTimersByTime(20000));
  expect(result.current.suppressPoll).toBe(false);
});

it("an older refused request cannot erase a newer denial fence", async () => {
  const { result } = setup();
  let refuse!: (reason: Error) => void;
  let pending!: Promise<unknown>;
  act(() => {
    pending = client
      .fetchQuery({
        queryKey: prefsKey,
        queryFn: () =>
          new Promise((_resolve, reject) => {
            refuse = reject;
          }),
      })
      .catch(() => undefined);
  });
  await read(roleKey, role());
  await act(async () => {
    await client
      .fetchQuery({
        queryKey: roleKey,
        queryFn: async () => {
          throw Object.assign(new Error("denied"), {
            data: { code: "FORBIDDEN" },
          });
        },
        staleTime: 0,
      })
      .catch(() => undefined);
  });
  expect(result.current.editable).toBe(false);
  await act(async () => {
    refuse(
      Object.assign(new Error("older denied"), { data: { code: "FORBIDDEN" } }),
    );
    await pending;
  });
  expect(result.current.editable).toBe(false);
});

for (const lifecycle of ["offline", "hidden"] as const)
  it(`${lifecycle} beyond60s returns read-only while new HTTP is held`, async () => {
    const { result, rerender } = setup();
    await read(roleKey, role());
    expect(result.current.canEditExecutive).toBe(true);
    if (lifecycle === "offline")
      rerender({ account: "org:actor", ready: true, online: false });
    else act(() => setAppPageActive(false));
    void act(() => vi.advanceTimersByTime(90000));
    if (lifecycle === "offline")
      rerender({ account: "org:actor", ready: true, online: true });
    else act(() => setAppPageActive(true));
    expect(result.current.editable).toBe(false);
    expect(result.current.canEditExecutive).toBe(false);
    expect(result.current.suppressPoll).toBe(false);
    let resolve!: (data: unknown) => void;
    let pending!: Promise<unknown>;
    act(() => {
      pending = client.fetchQuery({
        queryKey: roleKey,
        queryFn: () =>
          new Promise((done) => {
            resolve = done;
          }),
        staleTime: 0,
      });
    });
    expect(result.current.editable).toBe(false);
    expect(result.current.canEditExecutive).toBe(false);
    await act(async () => {
      resolve(role());
      await pending;
    });
    expect(result.current.canEditExecutive).toBe(true);
  });
