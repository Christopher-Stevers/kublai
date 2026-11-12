import { Activity, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAppPageActive } from "~/lib/app-page-activity";
const fixture = vi.hoisted(() => ({
  online: true,
  identity: vi.fn(),
  overview: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("~/lib/app-badge", () => ({ updateAppBadge: vi.fn() }));
vi.mock("./use-notification-reminder", () => ({
  useNotificationReminder: () => 0,
}));
vi.mock("~/components/simulation/SimulationProvider", () => ({
  useEmployeeSimulation: () => null,
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => fixture.online,
  getBrowserOnlineStatus: () => fixture.online,
}));
// Presentation seam only. Real Center/Dialog and real authority hook/query
// observers remain mounted; this body has no independent notification reads.
vi.mock("./NotificationPanel", () => ({
  default: () => (
    <input aria-label="Inbox local draft" defaultValue="retained" />
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      client: {
        notifications: {
          identity: { query: fixture.identity },
          overview: { query: fixture.overview },
        },
      },
      notifications: {
        overview: { invalidate: fixture.refresh },
        list: { invalidate: fixture.refresh },
      },
      drawingsWorkspace: { notifications: { invalidate: fixture.refresh } },
      chat: { getOverview: { invalidate: fixture.refresh } },
      conversations: { list: { invalidate: fixture.refresh } },
    }),
    notifications: {
      identity: { _def: () => ({ path: ["notifications", "identity"] }) },
      overview: { _def: () => ({ path: ["notifications", "overview"] }) },
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: [] }] },
          isError: false,
          isLoading: false,
          refetch: fixture.refresh,
          hasNextPage: false,
        }),
      },
      read: { useMutation: () => ({ mutateAsync: fixture.refresh }) },
    },
  },
}));
import { NotificationCenter } from "./NotificationCenter";
const clients: QueryClient[] = [];
beforeEach(() => {
  fixture.online = true;
  fixture.identity.mockReset().mockResolvedValue({ accountKey: "a:org" });
  fixture.overview
    .mockReset()
    .mockImplementation(async ({ accountKey }: { accountKey: string }) => ({
      accountKey,
      unreadCount: 2,
      readTargets: [],
    }));
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  setAppPageActive(true);
  vi.useRealTimers();
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  return {
    client,
    wrap: (node: ReactNode) => (
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    ),
  };
}
async function open() {
  const trigger = await screen.findByRole("button", {
    name: "Notifications, 2 unread",
  });
  fireEvent.click(trigger);
  await screen.findByLabelText("Inbox local draft");
  fireEvent.change(screen.getByLabelText("Inbox local draft"), {
    target: { value: "still editing" },
  });
}
function retained() {
  expect(screen.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  expect(screen.getByLabelText("Inbox local draft")).toHaveValue(
    "still editing",
  );
}
it("healthy real overview replies preserve open dialog identity and local state", async () => {
  const { client, wrap } = setup();
  render(wrap(<NotificationCenter sessionKey="a" />));
  await open();
  await act(async () => {
    await client.refetchQueries({ queryKey: [["notifications", "overview"]] });
  });
  retained();
  expect(fixture.overview).toHaveBeenCalledTimes(3); // bootstrap, explicit open, explicit refresh
  expect(fixture.identity).toHaveBeenCalledOnce();
});
it("offline and cooperative hidden/resume retain the actual Center dialog and draft", async () => {
  const { wrap } = setup();
  const view = render(wrap(<NotificationCenter sessionKey="a" />));
  await open();
  fixture.online = false;
  view.rerender(wrap(<NotificationCenter sessionKey="a" />));
  retained();
  fixture.online = true;
  view.rerender(wrap(<NotificationCenter sessionKey="a" />));
  await waitFor(() =>
    expect(fixture.identity.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  retained();
  act(() => setAppPageActive(false));
  retained();
  act(() => setAppPageActive(true));
  await waitFor(() =>
    expect(fixture.identity.mock.calls.length).toBeGreaterThanOrEqual(3),
  );
  retained();
});
it("React Activity pause retains dialog state while old authority is rechecked on resume", async () => {
  const { wrap } = setup();
  const view = render(
    wrap(
      <Activity mode="visible">
        <NotificationCenter sessionKey="a" />
      </Activity>,
    ),
  );
  await open();
  view.rerender(
    wrap(
      <Activity mode="hidden">
        <NotificationCenter sessionKey="a" />
      </Activity>,
    ),
  );
  view.rerender(
    wrap(
      <Activity mode="visible">
        <NotificationCenter sessionKey="a" />
      </Activity>,
    ),
  );
  await waitFor(() =>
    expect(fixture.identity.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  retained();
});
