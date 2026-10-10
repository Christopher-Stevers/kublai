import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppNotification } from "~/lib/app-notifications";
const mocks = vi.hoisted(() => ({
  read: vi.fn<
    (input: {
      accountKey: string;
      targets: AppNotification["target"][];
    }) => Promise<{ ok: boolean }>
  >(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  push: vi.fn(),
  next: vi.fn(),
  accountKey: "user:org" as string | null,
  validated: true,
  error: false,
  online: true,
  count: 2,
  items: [] as AppNotification[],
  targets: [] as AppNotification["target"][],
  listInput: {} as { unreadOnly?: boolean },
  more: false,
}));
vi.mock("./PushNotifications", () => ({
  PushNotifications: () => <button>Turn push notifications on</button>,
}));
vi.mock("./JobNotificationSettings", () => ({
  JobNotificationSettings: () => <button>Job chat notifications</button>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => mocks.online,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      notifications: {
        overview: { invalidate: mocks.invalidate },
        list: { invalidate: mocks.invalidate },
      },
      drawingsWorkspace: { notifications: { invalidate: mocks.invalidate } },
      chat: { getOverview: { invalidate: mocks.invalidate } },
      conversations: { list: { invalidate: mocks.invalidate } },
    }),
    notifications: {
      identity: {
        useQuery: () => ({
          data: { accountKey: mocks.accountKey },
          isFetchedAfterMount: mocks.validated,
          isLoading: false,
          refetch: mocks.refetch,
        }),
      },
      overview: {
        useQuery: (input: { accountKey: string }) => ({
          data: input.accountKey
            ? { unreadCount: mocks.count, readTargets: mocks.targets }
            : undefined,
          isError: mocks.error,
          refetch: mocks.refetch,
        }),
      },
      list: {
        useInfiniteQuery: (input: {
          accountKey: string;
          unreadOnly: boolean;
        }) => {
          mocks.listInput = input;
          return {
            data: input.accountKey
              ? { pages: [{ items: mocks.items }] }
              : undefined,
            isError: mocks.error,
            isLoading: false,
            refetch: mocks.refetch,
            hasNextPage: mocks.more,
            fetchNextPage: mocks.next,
          };
        },
      },
      read: { useMutation: () => ({ mutateAsync: mocks.read }) },
    },
  },
}));
import { NotificationCenter } from "./NotificationCenter";
const item: AppNotification = {
  id: "drawing:1",
  kind: "drawing",
  title: "Drawing assignment",
  context: "Site · M-101",
  description: "Check equipment tag",
  createdAt: "2026-10-09T10:00:00Z",
  unread: true,
  url: "/dashboard/jobs/job/drawings",
  target: { kind: "drawing", id: "11111111-1111-4111-8111-111111111111" },
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    accountKey: "user:org",
    validated: true,
    error: false,
    online: true,
    count: 2,
    items: [item],
    targets: [item.target],
    more: false,
  });
  mocks.read.mockResolvedValue({ ok: true });
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);

it("opens a keyboard accessible window without marking anything read", () => {
  render(<NotificationCenter />);
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  expect(screen.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  expect(screen.getByText("Check equipment tag")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Turn push notifications on" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Job chat notifications" }),
  ).toBeVisible();
  expect(mocks.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Unread" }));
  expect(mocks.listInput.unreadOnly).toBe(true);
});
it("marks a notification read and navigates to its destination", async () => {
  render(<NotificationCenter />);
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Drawing assignment/ }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(item.url));
  expect(mocks.read).toHaveBeenCalledWith({
    accountKey: "user:org",
    targets: [item.target],
  });
  expect(mocks.invalidate).toHaveBeenCalledTimes(5);
});
it("marks all unread items in batches, including those beyond the loaded page", async () => {
  mocks.targets = Array.from({ length: 205 }, (_, index) => ({
    ...item.target,
    id: String(index),
  }));
  render(<NotificationCenter />);
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  expect(mocks.read.mock.calls[0]?.[0].targets).toHaveLength(200);
  expect(mocks.read.mock.calls[1]?.[0].targets).toHaveLength(5);
});
it("retains a failed read and provides an actionable error", async () => {
  mocks.read.mockRejectedValueOnce(Error("Offline"));
  render(<NotificationCenter />);
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Drawing assignment/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not mark notifications as read",
  );
  expect(mocks.push).not.toHaveBeenCalled();
});
it("hides cached data when identity has not been revalidated or access is revoked", () => {
  mocks.validated = false;
  const { rerender } = render(<NotificationCenter />);
  expect(
    screen.queryByRole("button", { name: /2 unread/ }),
  ).not.toBeInTheDocument();
  mocks.validated = true;
  rerender(<NotificationCenter />);
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  mocks.error = true;
  rerender(<NotificationCenter />);
  expect(screen.queryByText("Check equipment tag")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Could not load notifications",
  );
});
it("closes and clears the previous account's window on an identity change", () => {
  const { rerender } = render(<NotificationCenter />);
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  mocks.accountKey = null;
  rerender(<NotificationCenter />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /2 unread/ }),
  ).not.toBeInTheDocument();
});
it("does not navigate to the previous account after an outstanding read completes", async () => {
  let finish: (value: { ok: boolean }) => void = () => undefined;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(<NotificationCenter />);
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Drawing assignment/ }));
  mocks.accountKey = null;
  rerender(<NotificationCenter />);
  finish({ ok: true });
  await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
  expect(mocks.push).not.toHaveBeenCalled();
});
it("shows the full accessible count, caps the badge and disables reads offline", () => {
  mocks.count = 125;
  mocks.online = false;
  render(<NotificationCenter />);
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 125 unread" }),
  );
  expect(screen.getByText("99+")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  expect(screen.getByText(/Connect to refresh/)).toBeInTheDocument();
});
it("loads older notifications and shows an empty inbox", () => {
  mocks.more = true;
  const { rerender } = render(<NotificationCenter />);
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(mocks.next).toHaveBeenCalled();
  mocks.items = [];
  mocks.count = 0;
  mocks.more = false;
  rerender(<NotificationCenter />);
  expect(screen.getByText("No notifications yet.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();
});
