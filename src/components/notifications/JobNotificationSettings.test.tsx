import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  muted: false,
  error: false,
  pending: false,
  accountKey: "user:org",
  update: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  query: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      notifications: {
        jobSettings: { invalidate: mocks.invalidate },
        overview: { invalidate: mocks.invalidate },
        list: { invalidate: mocks.invalidate },
      },
      chat: { getOverview: { invalidate: mocks.invalidate } },
    }),
    notifications: {
      jobSettings: {
        useQuery: (input: unknown, options: unknown) => {
          mocks.query(input, options);
          return {
            data: {
              accountKey: mocks.accountKey,
              jobs: [{ id: "job", name: "Site A", muted: mocks.muted }],
            },
            isLoading: false,
            isError: mocks.error,
            refetch: mocks.refetch,
          };
        },
      },
      setJobSettings: {
        useMutation: () => ({
          mutateAsync: mocks.update,
          isPending: mocks.pending,
        }),
      },
    },
  },
}));
import { JobNotificationSettings } from "./JobNotificationSettings";
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    muted: false,
    error: false,
    pending: false,
    accountKey: "user:org",
  });
  mocks.update.mockResolvedValue({ muted: true });
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);

it("lists job chats with switches, and never mutes on mount", () => {
  render(<JobNotificationSettings accountKey="user:org" isOnline />);
  expect(mocks.query).toHaveBeenLastCalledWith(
    { accountKey: "user:org" },
    expect.objectContaining({ enabled: true }),
  );
  expect(mocks.update).not.toHaveBeenCalled();
  expect(
    screen.getByRole("switch", { name: "Site A notifications" }),
  ).toHaveAttribute("aria-checked", "true");
});
it("mutes and unmutes a job from the notification window, refreshing its inbox", async () => {
  const view = render(
    <JobNotificationSettings accountKey="user:org" isOnline />,
  );
  fireEvent.click(screen.getByRole("switch", { name: "Site A notifications" }));
  await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(4));
  expect(mocks.update).toHaveBeenLastCalledWith({
    accountKey: "user:org",
    jobId: "job",
    muted: true,
  });
  mocks.muted = true;
  view.rerender(<JobNotificationSettings accountKey="user:org" isOnline />);
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() =>
    expect(mocks.update).toHaveBeenLastCalledWith({
      accountKey: "user:org",
      jobId: "job",
      muted: false,
    }),
  );
});
it("retains the current preference after a failed change", async () => {
  mocks.update.mockRejectedValue(Error("Offline"));
  render(<JobNotificationSettings accountKey="user:org" isOnline />);
  fireEvent.click(screen.getByRole("switch"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not change job notifications",
  );
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
});
it("hides a previous account's preferences and prevents changes offline", () => {
  const view = render(
    <JobNotificationSettings accountKey="different:org" isOnline />,
  );
  expect(screen.queryByRole("switch")).toBeNull();
  view.rerender(
    <JobNotificationSettings accountKey="user:org" isOnline={false} />,
  );
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Connect");
  expect(mocks.update).not.toHaveBeenCalled();
});
