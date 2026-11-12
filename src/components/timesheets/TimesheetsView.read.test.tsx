// Deferred during calibration quiet. Real QueryClient + actual refresh-behind hook;
// only transport/account/view-state boundaries are mocked, never query results.
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAppPageActive } from "~/lib/app-page-activity";

const fixture = vi.hoisted(() => ({
  online: true,
  accountUserId: "me",
  context: vi.fn<() => Promise<unknown>>(),
  period:
    vi.fn<(input: { date: string; userId: string }) => Promise<unknown>>(),
  mutation: vi.fn(),
}));
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({
  useDrawingAccount: () => ({
    userId: fixture.accountUserId,
    accountKey: `org:${fixture.accountUserId}`,
    organizationId: "org",
    store: null,
  }),
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => fixture.online,
  getBrowserOnlineStatus: () => fixture.online,
}));
vi.mock("~/hooks/use-timesheet-live", () => ({
  useTimesheetLive: () => undefined,
}));
vi.mock("~/hooks/use-page-view-state", async () => {
  const { useState } = await import("react");
  return {
    usePageViewState: (_key: string, initial: unknown) => useState(initial),
  };
});
vi.mock("~/components/ui/app-dialogs", () => ({
  notify: vi.fn(),
  confirmAction: vi.fn(),
}));
const queryKey = (name: string, input?: unknown) =>
  input === undefined
    ? [["timesheets", name], { type: "query" }]
    : [["timesheets", name], { input, type: "query" }];
vi.mock("~/trpc/react", async () => {
  const { useQuery, useQueryClient } = await import("@tanstack/react-query");
  const key = (name: string, input?: unknown) =>
    input === undefined
      ? [["timesheets", name], { type: "query" }]
      : [["timesheets", name], { input, type: "query" }];
  const endpoint = (name: string) => ({
    _def: () => ({ path: ["timesheets", name] }),
    useQuery: (input: { date: string; userId: string }, options: object) =>
      useQuery({
        ...options,
        queryKey: key(name, input),
        queryFn: () =>
          name === "context"
            ? fixture.context()
            : name === "period"
              ? fixture.period(input)
              : name === "list"
                ? Promise.resolve([
                    {
                      id: "team-sheet",
                      userId: "coworker",
                      name: "Synthetic teammate",
                      email: "teammate@example.invalid",
                      startDate: "2026-10-05",
                      endDate: "2026-10-11",
                      minutes: 60,
                      status: "submitted",
                    },
                  ])
                : Promise.resolve([]),
      }),
  });
  const mutation = {
    useMutation: () => ({ mutate: fixture.mutation, isPending: false }),
  };
  return {
    api: {
      useUtils: () => {
        const client = useQueryClient();
        return {
          timesheets: {
            invalidate: () =>
              client.invalidateQueries({ queryKey: [["timesheets"]] }),
          },
        };
      },
      timesheets: {
        context: endpoint("context"),
        period: endpoint("period"),
        list: endpoint("list"),
        report: endpoint("report"),
        activity: endpoint("activity"),
        saveEntry: mutation,
        deleteEntry: mutation,
        submit: mutation,
        withdraw: mutation,
        review: mutation,
        settings: mutation,
        clockStart: mutation,
        clockAction: mutation,
      },
    },
  };
});
import { TimesheetsView } from "./TimesheetsView";
const clients: QueryClient[] = [];
const info = (canManage = false) => ({
  settings: {
    cadence: "weekly",
    weekStartsOn: 1,
    timezone: "America/Toronto",
    revision: 3,
  },
  jobs: [{ id: "job", name: "Synthetic job" }],
  people: [
    { id: "me", name: "Me", email: "me@example.invalid" },
    {
      id: "coworker",
      name: "Synthetic teammate",
      email: "teammate@example.invalid",
    },
  ],
  me: "me",
  today: "2026-10-08",
  clock: null,
  canEdit: true,
  canManage,
  canConfigure: false,
});
const period = (
  jobName = "SAVED PERIOD",
  userId = "me",
  start = "2026-10-05",
) => ({
  userId,
  start,
  end: "2026-10-11",
  sheet: { id: "sheet", revision: 2, status: "draft", reviewNote: "" },
  entries: [
    {
      id: "entry",
      date: "2026-10-08",
      jobId: "job",
      jobName,
      category: "work",
      minutes: 60,
      breakMinutes: 0,
      costCode: "",
      notes: "",
      source: "manual",
    },
  ],
  events: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(context = info()) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 300_000, retry: false, gcTime: Infinity },
    },
  });
  clients.push(client);
  client.setQueryData(queryKey("context"), context);
  return {
    client,
    wrap: (node: ReactNode) => (
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    ),
  };
}
beforeEach(() => {
  fixture.online = true;
  fixture.accountUserId = "me";
  fixture.context.mockReset().mockResolvedValue(info());
  fixture.period.mockReset().mockResolvedValue(period("FRESH PERIOD"));
  fixture.mutation.mockReset();
  setAppPageActive(true);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  setAppPageActive(true);
});

it("paints exact own-user/date cached period while fresh HTTP waits, then replaces it", async () => {
  const { client, wrap } = setup();
  const next = deferred<ReturnType<typeof period>>();
  client.setQueryData(
    queryKey("period", { date: "2026-10-08", userId: "me" }),
    period(),
  );
  fixture.period.mockReturnValue(next.promise);
  render(wrap(<TimesheetsView />));
  expect(screen.getByText("SAVED PERIOD")).toBeInTheDocument();
  await waitFor(() =>
    expect(fixture.period).toHaveBeenCalledWith({
      date: "2026-10-08",
      userId: "me",
    }),
  );
  await act(async () => next.resolve(period("FRESH PERIOD")));
  await screen.findByText("FRESH PERIOD");
  expect(screen.queryByText("SAVED PERIOD")).not.toBeInTheDocument();
});
it("a different week cannot borrow previous rows or a late previous-key response", async () => {
  const { client, wrap } = setup();
  const old = deferred<ReturnType<typeof period>>(),
    next = deferred<ReturnType<typeof period>>();
  client.setQueryData(
    queryKey("period", { date: "2026-10-08", userId: "me" }),
    period(),
  );
  fixture.period.mockImplementation((input) =>
    input.date === "2026-10-08" ? old.promise : next.promise,
  );
  render(wrap(<TimesheetsView />));
  fireEvent.change(screen.getByLabelText("Date", { exact: true }), {
    target: { value: "2026-10-01" },
  });
  expect(screen.queryByText("SAVED PERIOD")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(fixture.period).toHaveBeenCalledWith({
      date: "2026-10-01",
      userId: "me",
    }),
  );
  await act(async () => old.resolve(period("LATE OLD WEEK")));
  expect(screen.queryByText("LATE OLD WEEK")).not.toBeInTheDocument();
  await act(async () =>
    next.resolve(period("CURRENT WEEK", "me", "2026-09-28")),
  );
  await screen.findByText("CURRENT WEEK");
});
it("uses the selected teammate key and hides it immediately after fresh manager authority is lost", async () => {
  const { client, wrap } = setup(info(true));
  fixture.context.mockResolvedValue(info(true));
  fixture.period.mockReturnValue(new Promise(() => undefined));
  client.setQueryData(
    queryKey("period", { date: "2026-10-08", userId: "me" }),
    period("OWN PERIOD"),
  );
  client.setQueryData(
    queryKey("period", { date: "2026-10-05", userId: "coworker" }),
    period("TEAM PERIOD", "coworker"),
  );
  render(wrap(<TimesheetsView />));
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Synthetic teammate/ }),
  );
  expect(screen.getByText("TEAM PERIOD")).toBeInTheDocument();
  expect(screen.queryByText("OWN PERIOD")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(fixture.period).toHaveBeenCalledWith({
      date: "2026-10-05",
      userId: "coworker",
    }),
  );
  fixture.context.mockResolvedValue(info(false));
  await act(async () => {
    await client.refetchQueries({ queryKey: queryKey("context"), exact: true });
  });
  expect(screen.queryByText("TEAM PERIOD")).not.toBeInTheDocument();
  expect(
    screen.getByText("You no longer have access to this timesheet."),
  ).toBeInTheDocument();
  expect(fixture.mutation).not.toHaveBeenCalled();
});
it("keeps cached rows on a transport failure with a saved-data notice", async () => {
  const { client, wrap } = setup();
  const next = deferred<ReturnType<typeof period>>();
  client.setQueryData(
    queryKey("period", { date: "2026-10-08", userId: "me" }),
    period(),
  );
  fixture.period.mockReturnValue(next.promise);
  render(wrap(<TimesheetsView />));
  await waitFor(() => expect(fixture.period).toHaveBeenCalledOnce());
  await act(async () => next.reject(new Error("Connection interrupted")));
  await screen.findByText(/Showing saved data/);
  expect(screen.getByText("SAVED PERIOD")).toBeInTheDocument();
});
for (const code of ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"])
  it(`hides cached rows after a real period ${code}`, async () => {
    const { client, wrap } = setup();
    client.setQueryData(
      queryKey("period", { date: "2026-10-08", userId: "me" }),
      period(),
    );
    fixture.period.mockRejectedValue(
      Object.assign(new Error("Period access denied"), { data: { code } }),
    );
    render(wrap(<TimesheetsView />));
    await screen.findByText("Period access denied");
    expect(screen.queryByText("SAVED PERIOD")).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing saved data/)).not.toBeInTheDocument();
  });
it("terminal context denial hides all saved private period content before any cache fence effect", async () => {
  const { client, wrap } = setup();
  client.setQueryData(
    queryKey("period", { date: "2026-10-08", userId: "me" }),
    period(),
  );
  fixture.period.mockReturnValue(new Promise(() => undefined));
  render(wrap(<TimesheetsView />));
  expect(screen.getByText("SAVED PERIOD")).toBeInTheDocument();
  fixture.context.mockRejectedValue(
    Object.assign(new Error("Session access denied"), {
      data: { code: "UNAUTHORIZED" },
    }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: queryKey("context"), exact: true });
  });
  await screen.findByText("Session access denied");
  expect(screen.queryByText("SAVED PERIOD")).not.toBeInTheDocument();
});
it("offline exact cache is readable but no write or fetch is enabled", () => {
  fixture.online = false;
  const { client, wrap } = setup();
  client.setQueryData(
    queryKey("period", { date: "2026-10-08", userId: "me" }),
    period(),
  );
  render(wrap(<TimesheetsView />));
  expect(screen.getByText("SAVED PERIOD")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Add time" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Clock in" }),
  ).toBeDisabled();
  expect(fixture.period).not.toHaveBeenCalled();
  expect(fixture.mutation).not.toHaveBeenCalled();
});
it("an unseen offline period is unavailable, not an empty timesheet or another user's cache", () => {
  fixture.online = false;
  const { client, wrap } = setup();
  client.setQueryData(
    queryKey("period", { date: "2026-10-08", userId: "coworker" }),
    period("OTHER PERSON", "coworker"),
  );
  render(wrap(<TimesheetsView />));
  expect(
    screen.getByText(
      "This timesheet period is unavailable offline. Connect to load it.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("OTHER PERSON")).not.toBeInTheDocument();
  expect(screen.queryByText(/No time recorded/)).not.toBeInTheDocument();
  expect(fixture.period).not.toHaveBeenCalled();
});
it("an authorized cached empty period remains an actual empty period offline", () => {
  fixture.online = false;
  const { client, wrap } = setup();
  client.setQueryData(
    queryKey("period", { date: "2026-10-08", userId: "me" }),
    { ...period(), sheet: null, entries: [] },
  );
  render(wrap(<TimesheetsView />));
  expect(
    screen.getByText(/No time recorded for this period/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/period is unavailable/)).not.toBeInTheDocument();
});
it("an account/context mismatch cannot paint the old account period", () => {
  fixture.accountUserId = "different-user";
  const { client, wrap } = setup();
  client.setQueryData(
    queryKey("period", { date: "2026-10-08", userId: "me" }),
    period(),
  );
  render(wrap(<TimesheetsView />));
  expect(screen.queryByText("SAVED PERIOD")).not.toBeInTheDocument();
  expect(fixture.period).not.toHaveBeenCalled();
});
it("a response with a mismatched userId is never rendered as the selected period", async () => {
  const { wrap } = setup();
  fixture.period.mockResolvedValue(period("WRONG RESPONSE", "coworker"));
  render(wrap(<TimesheetsView />));
  await screen.findByText(
    "This timesheet period is unavailable. Reopen it to retry.",
  );
  expect(screen.queryByText("WRONG RESPONSE")).not.toBeInTheDocument();
});

it("terminal period denial closes the old editor and does not reopen it on a later grant", async () => {
  const { client, wrap } = setup();
  const next = deferred<ReturnType<typeof period>>();
  client.setQueryData(
    queryKey("period", { date: "2026-10-08", userId: "me" }),
    period(),
  );
  fixture.period.mockReturnValue(next.promise);
  render(wrap(<TimesheetsView />));
  fireEvent.click(
    screen.getByRole("button", { name: "Edit time on 2026-10-08" }),
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await waitFor(() => expect(fixture.period).toHaveBeenCalledOnce());
  await act(async () =>
    next.reject(
      Object.assign(new Error("Period access denied"), {
        data: { code: "FORBIDDEN" },
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  fixture.period.mockResolvedValue(period("AUTHORIZED AGAIN"));
  await act(async () => {
    await client.refetchQueries({
      queryKey: queryKey("period", { date: "2026-10-08", userId: "me" }),
      exact: true,
    });
  });
  await screen.findByText("AUTHORIZED AGAIN");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fixture.mutation).not.toHaveBeenCalled();
});
it("a transient period refresh failure preserves an unsent local editor", async () => {
  const { client, wrap } = setup();
  const next = deferred<ReturnType<typeof period>>();
  client.setQueryData(
    queryKey("period", { date: "2026-10-08", userId: "me" }),
    period(),
  );
  fixture.period.mockReturnValue(next.promise);
  render(wrap(<TimesheetsView />));
  fireEvent.click(
    screen.getByRole("button", { name: "Edit time on 2026-10-08" }),
  );
  fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("Notes"), {
    target: { value: "unsent local draft" },
  });
  await waitFor(() => expect(fixture.period).toHaveBeenCalledOnce());
  await act(async () => next.reject(new Error("Connection interrupted")));
  expect(
    within(screen.getByRole("dialog")).getByLabelText("Notes"),
  ).toHaveValue("unsent local draft");
  expect(fixture.mutation).not.toHaveBeenCalled();
});
