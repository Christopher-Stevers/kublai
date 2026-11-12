import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  let release!: () => void;
  return {
    account: "first-account" as string | null,
    loads: 0,
    ready: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
    read: vi.fn(),
  };
});
vi.mock(
  "~/components/notifications/NotificationPanel",
  async () => {
    state.loads++;
    await state.ready;
    return {
      default: ({ accountKey }: { accountKey: string | null }) => (
        <p>Inbox for {accountKey}</p>
      ),
    };
  },
);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("~/lib/app-badge", () => ({ updateAppBadge: vi.fn() }));
vi.mock("~/components/simulation/SimulationProvider", () => ({
  useEmployeeSimulation: () => null,
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/components/notifications/use-notification-reminder", () => ({
  useNotificationReminder: () => 0,
}));
vi.mock("~/hooks/use-notification-account", () => ({
  useNotificationAccount: () => ({
    accountKey: state.account,
    online: true,
    identity: { isLoading: false },
    overview: {
      data: { unreadCount: 2, readTargets: [] },
      isFetchedAfterMount: true,
      isError: false,
      refetch: vi.fn(),
    },
    refreshIdentity: vi.fn(),
  }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    notifications: {
      identity: {
        useQuery: () => ({
          data: { accountKey: state.account },
          isFetchedAfterMount: true,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      overview: {
        useQuery: () => ({
          data: state.account ? { unreadCount: 2, readTargets: [] } : undefined,
          isFetchedAfterMount: true,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: [] }] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
          hasNextPage: false,
          isFetchingNextPage: false,
        }),
      },
      read: { useMutation: () => ({ mutateAsync: state.read }) },
    },
  },
}));
import { NotificationCenter } from "~/components/notifications/NotificationCenter";
afterEach(cleanup);

it("keeps the badge and close control immediate, loads the panel only on open, and fences a delayed panel across accounts", async () => {
  const view = render(<NotificationCenter />);
  expect(state.loads).toBe(0);
  expect(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  expect(screen.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  expect(screen.getByText("Loading notifications…")).toBeVisible();
  await waitFor(() => expect(state.loads).toBe(1));

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  expect(screen.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  expect(state.loads).toBe(1);

  state.account = "second-account";
  view.rerender(<NotificationCenter />);
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => {
    state.release();
  });
  expect(screen.queryByText("Inbox for first-account")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  expect(await screen.findByText("Inbox for second-account")).toBeVisible();
  expect(state.read).not.toHaveBeenCalled();
});
