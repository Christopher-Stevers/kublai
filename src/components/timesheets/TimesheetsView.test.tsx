import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  manager: false,
  online: true,
  status: "draft",
  failSave: false,
  clock: null as null | {
    id: string;
    revision: number;
    periods: Array<{ start: string; end: string | null; kind: string }>;
  },
  calls: [] as Array<[string, unknown]>,
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => state.online,
}));
vi.mock("~/components/ui/app-dialogs", () => ({
  notify: vi.fn(),
  confirmAction: async () => true,
}));
vi.mock("~/trpc/react", () => {
  const mutation = (name: string) => ({
    useMutation: (options: {
      onSuccess?: () => unknown;
      onError?: (e: { message: string }) => unknown;
    }) => ({
      isPending: false,
      mutate: (input: unknown) => {
        state.calls.push([name, input]);
        if (name === "saveEntry" && state.failSave)
          options.onError?.({ message: "Connection interrupted" });
        else void options.onSuccess?.();
      },
    }),
  });
  const job = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Alma" };
  return {
    api: {
      useUtils: () => ({ timesheets: { invalidate: vi.fn() } }),
      timesheets: {
        context: {
          useQuery: () => ({
            data: {
              settings: {
                cadence: "weekly",
                weekStartsOn: 1,
                timezone: "America/Toronto",
                revision: 3,
              },
              jobs: [job],
              people: [{ id: "me", name: "Tim", email: "tim@example.invalid" }],
              me: "me",
              today: "2026-10-08",
              clock: state.clock,
              canEdit: true,
              canManage: state.manager,
              canConfigure: state.manager,
            },
          }),
        },
        period: {
          useQuery: () => ({
            data: {
              start: "2026-10-05",
              end: "2026-10-11",
              userId: "me",
              sheet: {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                status: state.status,
                revision: 2,
                reviewNote: "",
              },
              entries: [
                {
                  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                  date: "2026-10-08",
                  jobId: job.id,
                  jobName: job.name,
                  category: "work",
                  minutes: 450,
                  breakMinutes: 30,
                  costCode: "",
                  notes: "",
                  source: "manual",
                },
              ],
              events: [],
            },
          }),
        },
        list: { useQuery: () => ({ data: [], isFetching: false }) },
        report: { useQuery: () => ({ data: [] }) },
        activity: { useQuery: () => ({ data: [] }) },
        saveEntry: mutation("saveEntry"),
        deleteEntry: mutation("deleteEntry"),
        submit: mutation("submit"),
        withdraw: mutation("withdraw"),
        review: mutation("review"),
        settings: mutation("settings"),
        clockStart: mutation("clockStart"),
        clockAction: mutation("clockAction"),
      },
    },
  };
});
import { TimesheetsView } from "./TimesheetsView";
beforeEach(() => {
  state.manager = false;
  state.online = true;
  state.status = "draft";
  state.clock = null;
  state.calls = [];
  state.failSave = false;
});
afterEach(cleanup);
describe("Timesheets real controls", () => {
  it("saves entered hours less unpaid break and retains notes/job allocation", () => {
    render(<TimesheetsView />);
    fireEvent.click(screen.getByRole("button", { name: "Add time" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Job"), {
      target: { value: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    });
    fireEvent.change(dialog.getByLabelText("Hours before unpaid break"), {
      target: { value: "8" },
    });
    fireEvent.change(dialog.getByLabelText("Unpaid break (minutes)"), {
      target: { value: "30" },
    });
    fireEvent.change(dialog.getByLabelText("Notes"), {
      target: { value: "Rough in" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save time" }));
    expect(
      state.calls.find(([name]) => name === "saveEntry")?.[1],
    ).toMatchObject({
      expectedRevision: 2,
      entry: {
        minutes: 450,
        breakMinutes: 30,
        notes: "Rough in",
        jobId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    });
  });
  it("keeps a failed time entry open for retry", () => {
    state.failSave = true;
    render(<TimesheetsView />);
    fireEvent.click(screen.getByRole("button", { name: "Add time" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Save time",
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByRole("alert"),
    ).toHaveTextContent("Connection interrupted");
  });
  it("locks approved hours and keeps management hidden from workers", () => {
    state.status = "approved";
    render(<TimesheetsView />);
    expect(screen.getByRole("button", { name: "Add time" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Edit time on 2026-10-08" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Company settings" }),
    ).not.toBeInTheDocument();
  });
  it("lets the company choose daily submission and a time zone", () => {
    state.manager = true;
    render(<TimesheetsView />);
    fireEvent.click(screen.getByRole("button", { name: "Company settings" }));
    fireEvent.change(screen.getByLabelText("Submission period"), {
      target: { value: "daily" },
    });
    fireEvent.change(screen.getByLabelText("Company time zone"), {
      target: { value: "Europe/London" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save company settings" }),
    );
    expect(state.calls).toContainEqual([
      "settings",
      {
        cadence: "daily",
        weekStartsOn: 1,
        timezone: "Europe/London",
        expectedRevision: 3,
      },
    ]);
  });
  it("starts job-coded clocks and offers resume/stop for a persistent break", () => {
    state.clock = {
      id: "clock",
      revision: 4,
      periods: [
        {
          start: "2026-10-08T12:00:00Z",
          end: "2026-10-08T13:00:00Z",
          kind: "work",
        },
        { start: "2026-10-08T13:00:00Z", end: null, kind: "break" },
      ],
    };
    render(<TimesheetsView />);
    fireEvent.click(screen.getByRole("button", { name: "End break" }));
    fireEvent.click(screen.getByRole("button", { name: /Clock out/ }));
    expect(state.calls).toContainEqual([
      "clockAction",
      { id: "clock", expectedRevision: 4, action: "resume" },
    ]);
    expect(state.calls).toContainEqual([
      "clockAction",
      { id: "clock", expectedRevision: 4, action: "stop" },
    ]);
  });
  it("disables mutations while offline", () => {
    state.online = false;
    render(<TimesheetsView />);
    expect(screen.getByRole("button", { name: "Add time" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clock in" })).toBeDisabled();
  });
});
