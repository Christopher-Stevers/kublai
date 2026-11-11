import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  MaterialSortProvider,
  useMaterialSortContext,
} from "./MaterialSortProvider";
import { defaultMaterialSortSettings } from "~/lib/material-sort-preferences";
const state = vi.hoisted(() => ({
  healthy: false,
  fetch: vi.fn(),
  mutate: vi.fn(),
  options: vi.fn(),
  authority: {} as object,
  roleFetch: vi.fn(),
  simulation: null as null | { id: string },
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/components/simulation/SimulationProvider", () => ({
  useEmployeeSimulation: () => state.simulation,
}));
vi.mock("~/hooks/use-material-sort-live", () => ({
  useMaterialSortLive: () => state.healthy,
}));
vi.mock("~/lib/device-query-cache", async (original) => ({
  ...(await original<object>()),
  captureDeviceReadAuthority: () => state.authority,
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (proc: { key: string }, input: unknown) => [
    proc.key,
    input ?? null,
  ],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => {
      const client = useQueryClient();
      return {
        user: {
          getMaterialSortPreferences: {
            setData: (input: unknown, data: unknown) =>
              client.setQueryData(["preferences", input], data),
          },
        },
      };
    },
    user: {
      getMyRole: {
        key: "role",
        useQuery: (_input: unknown, options: object) =>
          useQuery({
            queryKey: ["role", null],
            queryFn: state.roleFetch,
            ...options,
          }),
      },
      getMaterialSortPreferences: {
        key: "preferences",
        useQuery: (input: unknown, options: object) => {
          state.options(options);
          return useQuery({
            queryKey: ["preferences", input],
            queryFn: state.fetch,
            ...options,
          });
        },
      },
      setMaterialSortPreferences: {
        useMutation: () => ({ mutateAsync: state.mutate }),
      },
    },
  },
}));
const input = { expectedUserId: "actor", expectedOrganizationId: "org" },
  prefsKey = ["preferences", input],
  roleKey = ["role", null];
const prefs = {
  shared: defaultMaterialSortSettings,
  personal: defaultMaterialSortSettings,
  custom: true,
  initialized: true,
  canEditExecutive: true,
};
let client: QueryClient;
function Controls() {
  const value = useMaterialSortContext()!;
  return (
    <>
      <output data-testid="editable">{String(value.editable)}</output>
      <output data-testid="executive">{String(value.canEditExecutive)}</output>
      <output data-testid="editing-executive">{String(value.editingExecutive)}</output>
      <button onClick={() => value.setEditingExecutive(true)}>Shared</button>
      <button onClick={() => value.setEditingExecutive(false)}>Personal</button>
      <button onClick={() => value.setSortMode("recent")}>Recent</button>
    </>
  );
}
function view() {
  return (
    <QueryClientProvider client={client}>
      <MaterialSortProvider
        key={`org:actor:${state.simulation?.id ?? ""}`}
        userId="actor"
        organizationId="org"
      >
        <Controls />
      </MaterialSortProvider>
    </QueryClientProvider>
  );
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function role(
  scope = "org:actor",
  canEditExecutive = true,
  appAccess = true,
) {
  await act(async () => {
    await client.fetchQuery({
      queryKey: roleKey,
      queryFn: async () => ({
        accountScope: scope,
        canEditExecutive,
        appAccess,
      }),
      staleTime: 0,
    });
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  state.healthy = false;
  state.simulation = null;
  state.authority = {};
  state.fetch.mockReset().mockResolvedValue(prefs);
  state.mutate.mockReset().mockResolvedValue(prefs);
  state.options.mockReset();
  state.roleFetch
    .mockReset()
    .mockResolvedValue({
      accountScope: "org:actor",
      appAccess: true,
      canEditExecutive: true,
      permissions: {
        can: {
          "financial.view": true,
          "systems.access": true,
          "drawings.view": true,
          "drawings.upload": true,
          "drawings.delete": true,
        },
      },
    });
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
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("cached capabilities cannot grant access; successful own HTTP still permits editing in stream outage", async () => {
  let resolve!: (data: typeof prefs) => void;
  state.fetch.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  client.setQueryData(prefsKey, prefs);
  render(view());
  expect(screen.getByTestId("editable").textContent).toBe("false");
  expect(screen.getByTestId("executive").textContent).toBe("false");
  await act(async () => {
    resolve(prefs);
    await Promise.resolve();
  });
  await flush();
  expect(screen.getByTestId("editable").textContent).toBe("true");
  expect(state.options).toHaveBeenLastCalledWith(
    expect.objectContaining({ refetchInterval: 60000 }),
  );
  fireEvent.click(screen.getByText("Shared"));
  fireEvent.click(screen.getByText("Recent"));
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(state.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ target: "executive" }),
  );
});
it("only healthy topic/catchup plus fresh shared role HTTP removes interval, restoring it on loss/stale", async () => {
  state.healthy = true;
  const { rerender } = render(view());
  await flush();
  expect(state.options).toHaveBeenLastCalledWith(
    expect.objectContaining({ refetchInterval: 60000 }),
  );
  await role();
  expect(state.options).toHaveBeenLastCalledWith(
    expect.objectContaining({ refetchInterval: false }),
  );
  expect(
    client.getQueryCache().find({ queryKey: roleKey })?.getObserversCount(),
  ).toBe(0);
  state.healthy = false;
  rerender(view());
  await flush();
  expect(state.options).toHaveBeenLastCalledWith(
    expect.objectContaining({ refetchInterval: 60000 }),
  );
  expect(screen.getByTestId("executive").textContent).toBe("true");
  state.healthy = true;
  rerender(view());
  await flush();
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(state.options).toHaveBeenLastCalledWith(
    expect.objectContaining({ refetchInterval: 60000 }),
  );
});
it("role denial and full simulation transition cannot reuse direct-session executive authority", async () => {
  state.healthy = true;
  const { rerender } = render(view());
  await flush();
  await role();
  state.fetch.mockRejectedValue(
    Object.assign(new Error("denied"), { data: { code: "FORBIDDEN" } }),
  );
  await role("org:actor", false, false);
  expect(screen.getByTestId("editable").textContent).toBe("false");
  state.simulation = { id: "sim-one" };
  rerender(view());
  expect(screen.getByTestId("executive").textContent).toBe("false");
  await flush();
  await role("org:actor:simulation:sim-one", false, true);
  expect(screen.getByTestId("executive").textContent).toBe("false");
  fireEvent.click(screen.getByText("Shared"));
  fireEvent.click(screen.getByText("Recent"));
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(
    state.mutate.mock.calls.every(
      (call) => (call[0] as { target: string }).target !== "executive",
    ),
  ).toBe(true);
});

it("losing executive authority cannot redirect an open shared editor into a personal save", async () => {
  state.healthy = true;
  render(view());
  await flush();
  await role();
  fireEvent.click(screen.getByText("Shared"));
  expect(screen.getByTestId("editing-executive").textContent).toBe("true");

  // Personal access remains valid when the executive seat expires.
  await role("org:actor", false, true);
  expect(screen.getByTestId("editable").textContent).toBe("true");
  expect(screen.getByTestId("executive").textContent).toBe("false");
  fireEvent.click(screen.getByText("Recent"));
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(state.mutate).not.toHaveBeenCalled();

  // A deliberate switch to the personal editor still works.
  fireEvent.click(screen.getByText("Personal"));
  fireEvent.click(screen.getByText("Recent"));
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(state.mutate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ target: "personal" }),
  );
});

it("three existing permission providers retain exactly their shared role observers; sort adds none", async () => {
  const { FinancialVisibilityProvider } =
    await import("~/components/permissions/FinancialVisibility");
  const { SystemsAccessProvider } =
    await import("~/components/permissions/SystemsAccess");
  const { DrawingsAccessProvider } =
    await import("~/components/permissions/DrawingsAccess");
  state.healthy = true;
  render(
    <QueryClientProvider client={client}>
      <FinancialVisibilityProvider initialVisible={false}>
        <SystemsAccessProvider initialAllowed={false}>
          <DrawingsAccessProvider initialAllowed={false}>
            <MaterialSortProvider userId="actor" organizationId="org">
              <Controls />
            </MaterialSortProvider>
          </DrawingsAccessProvider>
        </SystemsAccessProvider>
      </FinancialVisibilityProvider>
    </QueryClientProvider>,
  );
  await flush();
  expect(
    client.getQueryCache().find({ queryKey: roleKey })?.getObserversCount(),
  ).toBe(3);
  expect(state.roleFetch).toHaveBeenCalledOnce();
  await act(async () => {
    vi.advanceTimersByTime(30000);
    await Promise.resolve();
  });
  expect(state.roleFetch).toHaveBeenCalledTimes(2);
  expect(
    client.getQueryCache().find({ queryKey: roleKey })?.getObserversCount(),
  ).toBe(3);
  expect(state.options).toHaveBeenLastCalledWith(
    expect.objectContaining({ refetchInterval: false }),
  );
});
