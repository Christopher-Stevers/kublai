import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationCenter } from "./NotificationCenter";
import { setAppPageActive } from "~/lib/app-page-activity";
const state = vi.hoisted(() => ({
  authority: {} as object,
  identity: vi.fn<() => Promise<{ accountKey: string | null }>>(),
  inputs: [] as string[],
}));
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({
  useDrawingAccount: () => ({ userId: "user", organizationId: "org" }),
}));
vi.mock("~/components/simulation/SimulationProvider", () => ({
  useEmployeeSimulation: () => null,
}));
vi.mock("~/lib/device-query-cache", () => ({
  captureDeviceReadAuthority: () => state.authority,
}));
vi.mock("~/lib/employee-simulation", () => ({
  simulationViewHeaders: () => ({ view: "user" }),
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/lib/app-badge", () => ({ updateAppBadge: vi.fn() }));
vi.mock("./use-notification-reminder", () => ({
  useNotificationReminder: () => 0,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (proc: { key: string }, input: unknown) => [
    proc.key,
    input ?? null,
  ],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    user: { getMyRole: { key: "role" } },
    useUtils: () => ({}),
    notifications: {
      identity: {
        key: "identity",
        useQuery: (input: unknown, options: object) =>
          useQuery({
            ...options,
            queryKey: ["identity", input],
            queryFn: () => state.identity(),
          }),
      },
      overview: {
        useQuery: (input: { accountKey: string }) => {
          state.inputs.push(input.accountKey);
          return {
            data: { unreadCount: input.accountKey ? 2 : 0 },
            isFetchedAfterMount: true,
          };
        },
      },
      list: { useInfiniteQuery: () => ({}) },
      read: { useMutation: () => ({}) },
    },
  },
}));
let client: QueryClient;
let stop: (() => void) | undefined;
const roleKey = ["role", null];
const role = (accountKey: string | null) => ({
  notificationIdentity: {
    accountKey,
    userId: "user",
    organizationId: "org",
    actorId: "user",
    simulationId: null,
  },
});
beforeEach(() => {
  state.authority = {};
  state.inputs = [];
  state.identity.mockReset().mockResolvedValue({ accountKey: "user:org" });
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
  stop?.();
  stop = undefined;
  client.clear();
});
it("wires real standalone HTTP receipts and shared-null denial without reusing stale identity", async () => {
  render(
    <QueryClientProvider client={client}>
      <NotificationCenter sessionKey="user" />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Notifications, 2 unread" });
  client.setQueryData(roleKey, role("user:org"));
  const observer = new QueryObserver(client, {
    queryKey: roleKey,
    enabled: true,
    staleTime: Infinity,
    queryFn: async () => role(null),
  });
  act(() => {
    stop = observer.subscribe(() => undefined);
  });
  await act(async () => {
    await client.fetchQuery({
      queryKey: roleKey,
      staleTime: 0,
      queryFn: async () => role(null),
    });
  });
  expect(screen.getByRole("button", { name: "Notifications" })).toBeVisible();
  const calls = state.identity.mock.calls.length;
  expect(
    client
      .getQueryCache()
      .find({ queryKey: ["identity", { sessionKey: "user" }] })
      ?.isActive(),
  ).toBe(false);
  state.identity.mockResolvedValue({ accountKey: "new:org" });
  act(() => {
    observer.setOptions({ queryKey: roleKey, enabled: false });
  });
  await waitFor(() =>
    expect(state.identity.mock.calls.length).toBeGreaterThan(calls),
  );
  await waitFor(() => expect(state.inputs.at(-1)).toBe("new:org"));
});
