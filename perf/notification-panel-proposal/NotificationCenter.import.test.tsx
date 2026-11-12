import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("~/lib/app-badge", () => ({ updateAppBadge: vi.fn() }));
vi.mock("~/components/simulation/SimulationProvider", () => ({
  useEmployeeSimulation: () => null,
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("./use-notification-reminder", () => ({
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
import { loadTestPanel } from "./test-loader";
import { NotificationCenter } from "./test-subject/NotificationCenter";
afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const panel = {
  default: ({ accountKey }: { accountKey: string | null }) => (
    <p>Inbox for {accountKey}</p>
  ),
};

it("requires explicit Retry after import refusal and keeps Close and parent filter state", async () => {
  state.account = "first-account";
  const first = deferred<typeof panel>();
  const next = deferred<typeof panel>();
  loadTestPanel
    .mockReset()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(next.promise);
  render(<NotificationCenter />);
  expect(loadTestPanel).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  await act(async () => {
    first.reject(new Error("fixture import refused"));
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Notifications could not be loaded.",
  );
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  expect(loadTestPanel).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(loadTestPanel).toHaveBeenCalledTimes(2);
  await act(async () => {
    next.resolve(panel);
  });
  expect(screen.getByText("Inbox for first-account")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  expect(loadTestPanel).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Inbox for first-account")).toBeVisible();
});

it("fences a pending import across A to B to A without reviving the old inbox", async () => {
  state.account = "first-account";
  const old = deferred<typeof panel>();
  const fresh = deferred<typeof panel>();
  loadTestPanel
    .mockReset()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise);
  const view = render(<NotificationCenter />);
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  state.account = "second-account";
  view.rerender(<NotificationCenter />);
  state.account = "first-account";
  view.rerender(<NotificationCenter />);
  await act(async () => {
    old.resolve(panel);
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Inbox for first-account")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Notifications, 2 unread" }),
  );
  expect(screen.getByText("Loading notifications…")).toBeVisible();
  expect(loadTestPanel).toHaveBeenCalledTimes(2);
  await act(async () => {
    fresh.resolve(panel);
  });
  expect(screen.getByText("Inbox for first-account")).toBeVisible();
  expect(state.read).not.toHaveBeenCalled();
});
