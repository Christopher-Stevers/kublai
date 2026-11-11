import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
  useQuery,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  blocksCachedRead,
  useTierOneReadOptions,
} from "./use-tier-one-read-options";
import { DeviceReadNotice } from "~/components/ui/device-read-notice";
import {
  DEVICE_QUERY_DENIED_EVENT,
  startDeviceQueryCache,
} from "~/lib/device-query-cache";
import { setAppPageActive } from "~/lib/app-page-activity";

const key = [["assets", "overview"], { type: "query" }];
const clients: QueryClient[] = [];
const stops: (() => Promise<void>)[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(load: () => Promise<{ label: string }>) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 300_000, retry: false } },
  });
  clients.push(client);
  client.setQueryData(key, { label: "saved value" });
  function Read() {
    const query = useQuery({
      queryKey: key,
      queryFn: load,
      ...useTierOneReadOptions(key),
    });
    return blocksCachedRead(query) ? (
      <p role="alert">Read unavailable</p>
    ) : (
      <>
        <span>{query.data?.label ?? "Loading"}</span>
        <DeviceReadNotice query={query} />
      </>
    );
  }
  function Fence({ children }: { children: ReactNode }) {
    const [locked, lock] = useState(false);
    useEffect(() => {
      const denied = () => lock(true);
      window.addEventListener(DEVICE_QUERY_DENIED_EVENT, denied);
      return () =>
        window.removeEventListener(DEVICE_QUERY_DENIED_EVENT, denied);
    }, []);
    return locked ? <p role="alert">Workspace locked</p> : children;
  }
  const view = () => (
    <QueryClientProvider client={client}>
      <Fence>
        <Read />
      </Fence>
    </QueryClientProvider>
  );
  return { client, view };
}
afterEach(async () => {
  cleanup();
  for (const stop of stops.splice(0)) await stop();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  setAppPageActive(true);
});

it("paints a fresh cached value while one mount request runs, then applies the accepted response", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const request = deferred<{ label: string }>(),
    load = vi.fn(() => request.promise),
    app = fixture(load);
  render(app.view());
  expect(screen.getByText("saved value")).toBeVisible();
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  await act(async () => request.resolve({ label: "remote change" }));
  expect(await screen.findByText("remote change")).toBeVisible();
});

it("opens a fresh offline cache without fetching and revalidates once on reconnect inside five minutes", async () => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  onlineManager.setOnline(false);
  const request = deferred<{ label: string }>(),
    load = vi.fn(() => request.promise),
    app = fixture(load);
  render(app.view());
  expect(screen.getByText("saved value")).toBeVisible();
  expect(load).not.toHaveBeenCalled();
  act(() => {
    online.mockReturnValue(true);
    onlineManager.setOnline(true);
    window.dispatchEvent(new Event("online"));
  });
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  expect(screen.getByText("saved value")).toBeVisible();
  await act(async () => request.resolve({ label: "reconnected value" }));
  expect(await screen.findByText("reconnected value")).toBeVisible();
});

it("revalidates a fresh retained view on activation and does not start reads while the internal page is paused", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  setAppPageActive(false);
  const request = deferred<{ label: string }>(),
    load = vi.fn(() => request.promise),
    app = fixture(load);
  render(app.view());
  expect(screen.getByText("saved value")).toBeVisible();
  expect(load).not.toHaveBeenCalled();
  act(() => setAppPageActive(true));
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  await act(async () => request.resolve({ label: "active value" }));
  act(() => setAppPageActive(false));
  load.mockResolvedValue({ label: "resumed value" });
  act(() => setAppPageActive(true));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("resumed value")).toBeVisible();
});

it("retains cached content with a quiet notice after a transient refresh error", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const load = vi.fn().mockRejectedValue(new Error("Connection interrupted")),
    app = fixture(load);
  render(app.view());
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Showing saved data"),
  );
  expect(screen.getByText("saved value")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("locks instead of retaining private paint after an authoritative denial", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const load = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
      ),
    app = fixture(load);
  const cache = startDeviceQueryCache(app.client, "org:actor", {
    read: async () => undefined,
    write: async () => undefined,
    clear: async () => undefined,
  });
  stops.push(() => cache.stop());
  await cache.ready;
  render(app.view());
  expect(screen.getByText("saved value")).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Workspace locked"),
  );
  expect(screen.queryByText("saved value")).toBeNull();
});

it("revalidates a newly selected fresh cache key without fetching an ineligible unopened selection", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 300_000, retry: false } },
  });
  clients.push(client);
  const first = [
    ["drawings", "getSet"],
    { input: { setId: "first" }, type: "query" },
  ];
  const second = [
    ["drawings", "getSet"],
    { input: { setId: "second" }, type: "query" },
  ];
  client.setQueryData(first, { label: "saved first" });
  client.setQueryData(second, { label: "saved second" });
  const request = deferred<{ label: string }>(),
    load = vi.fn(() => request.promise);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ selected, eligible }) =>
      useQuery({
        queryKey: selected,
        queryFn: load,
        ...useTierOneReadOptions(selected, eligible),
      }),
    { wrapper, initialProps: { selected: first, eligible: false } },
  );
  expect(hook.result.current.data?.label).toBe("saved first");
  expect(load).not.toHaveBeenCalled();
  hook.rerender({ selected: second, eligible: true });
  expect(hook.result.current.data?.label).toBe("saved second");
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  await act(async () => request.resolve({ label: "updated second" }));
  await waitFor(() =>
    expect(hook.result.current.data?.label).toBe("updated second"),
  );
  expect(client.getQueryData(first)).toEqual({ label: "saved first" });
});

it("drops a scheduled resume refresh after unmount or account-cache replacement", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  for (const leave of ["unmount", "cache-replace"] as const) {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 300_000, retry: false } },
    });
    clients.push(client);
    client.setQueryData(key, { label: "saved" });
    const load = vi.fn(async () => ({ label: "fresh" }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      ({ enabled }) =>
        useQuery({
          queryKey: key,
          queryFn: load,
          ...useTierOneReadOptions(key, enabled),
        }),
      { wrapper, initialProps: { enabled: false } },
    );
    const refetch = vi.spyOn(client, "refetchQueries");
    hook.rerender({ enabled: true });
    // Both happen before the guarded microtask can dispatch.
    if (leave === "unmount") hook.unmount();
    else {
      client.clear();
      client.setQueryData(key, { label: "new account value" });
    }
    await act(async () => {
      await Promise.resolve();
    });
    expect(refetch).not.toHaveBeenCalled();
    hook.unmount();
  }
});
