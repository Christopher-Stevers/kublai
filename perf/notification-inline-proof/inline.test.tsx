import { Activity, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppNotification } from "~/lib/app-notifications";
import { setAppPageActive } from "~/lib/app-page-activity";
const fixture = vi.hoisted(() => ({
  online: true,
  simulation: null as null | { id: string },
  identity: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  overview: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  list: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  settings: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  read: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  updateSettings: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
  push: vi.fn<(href: string) => void>(),
  muted: false,
  unread: true,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: fixture.push }),
}));
vi.mock("~/lib/app-badge", () => ({ updateAppBadge: vi.fn() }));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => fixture.online,
  getBrowserOnlineStatus: () => fixture.online,
}));
vi.mock("~/components/simulation/SimulationProvider", () => ({
  useEmployeeSimulation: () => fixture.simulation,
}));
// Only the unrelated external push capability is replaced; actual inline body,
// filters, row/read, settings mode, JobNotificationSettings and Dialog remain.
vi.mock("~/components/notifications/PushNotifications", () => ({
  PushNotifications: () => <p>External push capability fixture</p>,
}));
vi.mock("~/trpc/react", () => {
  const qkey = (name: string, input: unknown, type = "query") => [
    ["notifications", name],
    { input, type },
  ];
  const query = (name: string, load: typeof fixture.identity) => ({
    _def: () => ({ path: ["notifications", name] }),
    useQuery: (input: Record<string, unknown>, options: object) =>
      useQuery({
        ...options,
        queryKey: qkey(name, input),
        queryFn: () => load(input),
      }),
  });
  return {
    api: {
      useUtils: () => {
        const client = useInlineClient();
        const invalidate = (name: string) => (input: unknown) =>
          client.invalidateQueries({
            queryKey: [["notifications", name], { input }],
          });
        return {
          client: {
            notifications: {
              identity: { query: fixture.identity },
              overview: { query: fixture.overview },
            },
          },
          notifications: {
            overview: { invalidate: invalidate("overview") },
            list: { invalidate: invalidate("list") },
            jobSettings: { invalidate: invalidate("jobSettings") },
          },
          drawingsWorkspace: {
            notifications: { invalidate: async () => undefined },
          },
          chat: { getOverview: { invalidate: async () => undefined } },
          conversations: { list: { invalidate: async () => undefined } },
        };
      },
      notifications: {
        identity: query("identity", fixture.identity),
        overview: query("overview", fixture.overview),
        jobSettings: query("jobSettings", fixture.settings),
        list: {
          useInfiniteQuery: (input: Record<string, unknown>, options: object) =>
            useInfiniteQuery({
              getNextPageParam: () => undefined,
              ...options,
              queryKey: qkey("list", input, "infinite"),
              queryFn: () => fixture.list(input),
              initialPageParam: null,
            }),
        },
        read: {
          useMutation: () =>
            useMutation({
              mutationFn: (input: Record<string, unknown>) =>
                fixture.read(input),
            }),
        },
        setJobSettings: {
          useMutation: () =>
            useMutation({
              mutationFn: (input: Record<string, unknown>) =>
                fixture.updateSettings(input),
            }),
        },
      },
    },
  };
});
// Imported binding is initialized before the mocked hook executes.
import { useQueryClient as useInlineClient } from "@tanstack/react-query";
import { NotificationCenter } from "~/components/notifications/NotificationCenter";
const clients: QueryClient[] = [];
const target = {
  kind: "drawing" as const,
  id: "11111111-1111-4111-8111-111111111111",
};
const item = (unread = true): AppNotification => ({
  id: "drawing:synthetic",
  kind: "drawing",
  title: "Synthetic task",
  context: "Synthetic job",
  description: "Review fixture",
  createdAt: "2026-11-11T12:00:00Z",
  unread,
  url: "/jobs/synthetic/drawings",
  target,
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
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  fixture.online = true;
  fixture.simulation = null;
  fixture.unread = true;
  fixture.muted = false;
  fixture.push.mockReset();
  fixture.identity.mockReset().mockResolvedValue({ accountKey: "a:org" });
  fixture.overview.mockReset().mockImplementation(async (input) => ({
    accountKey: String(input.accountKey),
    unreadCount: fixture.unread ? 1 : 0,
    readTargets: fixture.unread ? [target] : [],
  }));
  fixture.list.mockReset().mockImplementation(async (input) => ({
    items: !input.unreadOnly || fixture.unread ? [item(fixture.unread)] : [],
    nextCursor: null,
  }));
  fixture.settings.mockReset().mockImplementation(async () => ({
    accountKey: "a:org",
    jobs: [
      { id: "synthetic-job", name: "Synthetic job", muted: fixture.muted },
    ],
  }));
  fixture.read.mockReset().mockImplementation(async () => {
    fixture.unread = false;
    return { ok: true };
  });
  fixture.updateSettings.mockReset().mockImplementation(async (input) => {
    fixture.muted = input.muted === true;
    return { ok: true };
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  setAppPageActive(true);
});
async function open() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Notifications, 1 unread" }),
  );
  await screen.findByRole("button", { name: /Synthetic task/ });
}
function all() {
  fireEvent.click(screen.getByRole("button", { name: "All" }));
}
it("actual inline rows and All filter survive real overview refresh and retain the same dialog", async () => {
  const { client, wrap } = setup();
  render(wrap(<NotificationCenter sessionKey="a" />));
  await open();
  all();
  await waitFor(() =>
    expect(fixture.list).toHaveBeenCalledWith(
      expect.objectContaining({ unreadOnly: false }),
    ),
  );
  const dialog = screen.getByRole("dialog", { name: "Notifications" });
  await act(async () => {
    await client.refetchQueries({ queryKey: [["notifications", "overview"]] });
  });
  expect(screen.getByRole("dialog", { name: "Notifications" })).toBe(dialog);
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: /Synthetic task/ })).toBeVisible();
  expect(fixture.identity).toHaveBeenCalledOnce();
});
it("actual settings mode and job switch survive benign refresh, returning to the retained All filter", async () => {
  const { client, wrap } = setup();
  render(wrap(<NotificationCenter sessionKey="a" />));
  await open();
  all();
  fireEvent.click(
    screen.getByRole("button", { name: "Notification settings" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Notification settings" });
  const setting = await screen.findByRole("switch", {
    name: "Synthetic job notifications",
  });
  fireEvent.click(setting);
  await waitFor(() =>
    expect(fixture.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ muted: true }),
    ),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: [["notifications", "overview"]] });
  });
  expect(screen.getByRole("dialog", { name: "Notification settings" })).toBe(
    dialog,
  );
  expect(
    screen.getByRole("switch", { name: "Synthetic job notifications" }),
  ).toHaveAttribute("aria-checked", "false");
  fireEvent.click(
    screen.getByRole("button", { name: "Back to notifications" }),
  );
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
it("actual unread row selection waits for read ACK, refreshes, closes and uses the original destination", async () => {
  const { wrap } = setup(),
    ack = deferred<{ ok: boolean }>();
  fixture.read.mockReturnValueOnce(ack.promise);
  render(wrap(<NotificationCenter sessionKey="a" />));
  await open();
  fireEvent.click(screen.getByRole("button", { name: /Synthetic task/ }));
  await waitFor(() =>
    expect(fixture.read).toHaveBeenCalledWith({
      accountKey: "a:org",
      targets: [target],
    }),
  );
  expect(screen.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  expect(fixture.push).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /Synthetic task/ })).toBeDisabled();
  await act(async () => {
    fixture.unread = false;
    ack.resolve({ ok: true });
  });
  await waitFor(() =>
    expect(fixture.push).toHaveBeenCalledWith("/jobs/synthetic/drawings"),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("actual inline Close and open state/filter survive offline, cooperative pause and Activity resume", async () => {
  const { wrap } = setup();
  let mode: "visible" | "hidden" = "visible";
  const node = () =>
    wrap(
      <Activity mode={mode}>
        <NotificationCenter sessionKey="a" />
      </Activity>,
    );
  const view = render(node());
  await open();
  all();
  const dialog = screen.getByRole("dialog", { name: "Notifications" });
  fixture.online = false;
  view.rerender(node());
  expect(screen.getByRole("dialog", { name: "Notifications" })).toBe(dialog);
  fixture.online = true;
  view.rerender(node());
  await waitFor(() =>
    expect(fixture.identity.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  act(() => setAppPageActive(false));
  act(() => setAppPageActive(true));
  mode = "hidden";
  view.rerender(node());
  mode = "visible";
  view.rerender(node());
  await waitFor(() =>
    expect(fixture.identity.mock.calls.length).toBeGreaterThanOrEqual(3),
  );
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("manual cached identity cannot open old rows before an actual scoped reply", async () => {
  const { client, wrap } = setup(),
    pending = deferred<{ accountKey: string }>();
  client.setQueryData(
    [
      ["notifications", "identity"],
      { input: { sessionKey: "a" }, type: "query" },
    ],
    { accountKey: "cached:org" },
  );
  fixture.identity.mockReturnValue(pending.promise);
  render(wrap(<NotificationCenter sessionKey="a" />));
  fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
  expect(
    screen.queryByRole("button", { name: /Synthetic task/ }),
  ).not.toBeInTheDocument();
  expect(fixture.overview).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ accountKey: "a:org" }));
  await open();
  expect(screen.getByRole("button", { name: /Synthetic task/ })).toBeVisible();
});
it("terminal overview failure hides the actual old inline inbox until fresh identity returns", async () => {
  const { client, wrap } = setup();
  render(wrap(<NotificationCenter sessionKey="a" />));
  await open();
  const recovery = deferred<{ accountKey: string }>();
  fixture.identity.mockReturnValueOnce(recovery.promise);
  fixture.overview.mockRejectedValueOnce(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: [["notifications", "overview"]] });
  });
  await waitFor(() => expect(fixture.identity).toHaveBeenCalledTimes(2));
  expect(
    screen.queryByRole("button", { name: /Synthetic task/ }),
  ).not.toBeInTheDocument();
  await act(async () => recovery.resolve({ accountKey: "a:org" }));
  expect(fixture.overview).toHaveBeenCalledTimes(3);
});
