"use client";
import { usePageViewState } from "~/hooks/use-page-view-state";

import { useEffect, useMemo, useState } from "react";
import {
  ClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  DownloadIcon,
} from "lucide-react";
import { api, type RouterOutputs } from "~/trpc/react";
import type { TimeSettings } from "~/lib/timesheets";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { confirmAction, notify } from "~/components/ui/app-dialogs";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  addDays,
  entryInput,
  hours,
  settingsInput,
  timeCategories,
  timeCsv,
} from "~/lib/timesheets";

const field =
  "bg-background min-h-10 w-full min-w-0 rounded-md border px-3 py-2 text-sm";
const label = "grid min-w-0 gap-1 text-sm";
type Draft = {
  id: string;
  date: string;
  jobId: string;
  category: (typeof timeCategories)[number];
  hours: string;
  breakMinutes: string;
  costCode: string;
  notes: string;
};
const statusClass: Record<string, string> = {
  approved: "text-emerald-600",
  submitted: "text-blue-500",
  returned: "text-amber-600",
  draft: "text-muted-foreground",
};
const cap = (value: string) => value[0]!.toUpperCase() + value.slice(1);

export function TimesheetsView() {
  const online = useOnlineStatus();
  const context = api.timesheets.context.useQuery(undefined, {
    enabled: online,
    refetchInterval: online ? 30000 : false,
  });
  if (!context.data)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-bold">Timesheets</h1>
        <p role={context.error || !online ? "alert" : "status"}>
          {context.error?.message ??
            (!online ? "Reconnect to load timesheets." : "Loading timesheets…")}
        </p>
      </div>
    );
  return (
    <TimesheetsContent
      info={context.data}
      contextError={context.error?.message}
    />
  );
}
function TimesheetsContent({
  info,
  contextError,
}: {
  info: RouterOutputs["timesheets"]["context"];
  contextError?: string;
}) {
  const online = useOnlineStatus();
  const utils = api.useUtils();
  const [tab, setTab] = usePageViewState<
    "my" | "team" | "detail" | "reports" | "settings" | "activity"
  >("timesheets:tab", "my");
  const [date, setDate] = usePageViewState("timesheets:date", info.today);
  const [person, setPerson] = useState<string | undefined>();
  const [from, setFrom] = usePageViewState("timesheets:from", addDays(info.today, -28)),
    [to, setTo] = usePageViewState("timesheets:to", info.today);
  const detail = api.timesheets.period.useQuery(
    { date, userId: person },
    { enabled: online && !!info && (tab === "my" || tab === "detail") },
  );
  const [status, setStatus] = usePageViewState<
    "all" | "draft" | "submitted" | "approved" | "returned"
  >("timesheets:status", "submitted");
  const [offset, setOffset] = usePageViewState("timesheets:offset", 0);
  const list = api.timesheets.list.useQuery(
    {
      from,
      to,
      team: tab === "team",
      status: tab === "team" ? status : "all",
      offset,
    },
    { enabled: online && !!info && (tab === "team" || tab === "my") },
  );
  const [approvedOnly, setApprovedOnly] = usePageViewState("timesheets:approvedOnly", true),
    [reportJob, setReportJob] = usePageViewState("timesheets:reportJob", "");
  const report = api.timesheets.report.useQuery(
    {
      from,
      to,
      team: info?.canManage ?? false,
      approvedOnly,
      jobId: reportJob || undefined,
    },
    { enabled: online && !!info && tab === "reports" },
  );
  const activity = api.timesheets.activity.useQuery(
    { team: info?.canManage ?? false, offset },
    { enabled: online && !!info && tab === "activity" },
  );
  const [draft, setDraft] = useState<Draft | null>(null),
    [error, setError] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState<string | null>(null);
  const [clockJob, setClockJob] = useState(""),
    [clockNote, setClockNote] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<{
    revision: number;
    value: TimeSettings;
  } | null>(null);
  const settings: TimeSettings =
    settingsDraft?.revision === info.settings.revision
      ? settingsDraft.value
      : info.settings;
  const setSettings = (
    update: TimeSettings | ((old: TimeSettings) => TimeSettings),
  ) =>
    setSettingsDraft({
      revision: info.settings.revision,
      value: typeof update === "function" ? update(settings) : update,
    });
  const refresh = async () => {
    setError(null);
    await utils.timesheets.invalidate();
  };
  const failed = (e: { message: string }) => {
    setError(e.message);
    notify(e.message, "error");
  };
  const saveEntry = api.timesheets.saveEntry.useMutation({
    onSuccess: async () => {
      setDraft(null);
      setError(null);
      await refresh();
    },
    onError: failed,
  });
  const remove = api.timesheets.deleteEntry.useMutation({
    onSuccess: refresh,
    onError: failed,
  });
  const submit = api.timesheets.submit.useMutation({
    onSuccess: refresh,
    onError: failed,
  });
  const withdraw = api.timesheets.withdraw.useMutation({
    onSuccess: refresh,
    onError: failed,
  });
  const review = api.timesheets.review.useMutation({
    onSuccess: async () => {
      setReturnReason(null);
      await refresh();
    },
    onError: failed,
  });
  const configure = api.timesheets.settings.useMutation({
    onSuccess: async () => {
      notify("Company timesheet settings saved.", "success");
      await refresh();
    },
    onError: failed,
  });
  const start = api.timesheets.clockStart.useMutation({
    onSuccess: refresh,
    onError: failed,
  });
  const clockAction = api.timesheets.clockAction.useMutation({
    onSuccess: refresh,
    onError: failed,
  });
  const busy =
    saveEntry.isPending ||
    remove.isPending ||
    submit.isPending ||
    withdraw.isPending ||
    review.isPending ||
    configure.isPending ||
    start.isPending ||
    clockAction.isPending;
  const selected = detail.data,
    sheet = selected?.sheet;
  const editable =
    online &&
    !busy &&
    !!info &&
    (person && person !== info.me ? info.canManage : info.canEdit) &&
    (!sheet || ["draft", "returned"].includes(sheet.status));
  const sheetArgs = sheet
    ? { sheetId: sheet.id, expectedRevision: sheet.revision }
    : null;
  const [now, setNow] = useState(() => Date.now());
  const activeClockId = info?.clock?.id;
  useEffect(() => {
    if (!activeClockId) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeClockId]);
  const elapsed =
    info?.clock?.periods.reduce(
      (total, period) =>
        total +
        (period.kind === "work"
          ? Math.max(
              0,
              new Date(period.end ?? now).getTime() -
                new Date(period.start).getTime(),
            )
          : 0),
      0,
    ) ?? 0;
  const timerSeconds = Math.floor(elapsed / 1000);
  const elapsedText = `${Math.floor(timerSeconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((timerSeconds / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(timerSeconds % 60).toString().padStart(2, "0")}`;
  const paused = info?.clock?.periods.at(-1)?.kind === "break";
  const periodTotal =
    selected?.entries.reduce((total, entry) => total + entry.minutes, 0) ?? 0;
  const summaries = useMemo(() => {
    const employees = new Map<string, { name: string; minutes: number }>(),
      jobTotals = new Map<string, number>();
    for (const row of report.data ?? []) {
      const employee = employees.get(row.userId) ?? {
        name: row.employee ?? row.email,
        minutes: 0,
      };
      employee.minutes += row.minutes;
      employees.set(row.userId, employee);
      jobTotals.set(row.job, (jobTotals.get(row.job) ?? 0) + row.minutes);
    }
    return {
      employees: [...employees.values()],
      jobs: [...jobTotals].map(([name, minutes]) => ({ name, minutes })),
      total: (report.data ?? []).reduce((sum, entry) => sum + entry.minutes, 0),
    };
  }, [report.data]);
  const chooseTab = (next: typeof tab) => {
    setTab(next);
    setError(null);
    setOffset(0);
    if (next === "my") setPerson(undefined);
  };
  const rangeControls = (
    <div className="flex flex-wrap items-end gap-3">
      <label className={label}>
        From
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      <label className={label}>
        To
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setOffset(0);
          }}
        />
      </label>
    </div>
  );
  const clockCommand = (action: "pause" | "resume" | "stop" | "cancel") => {
    if (info?.clock)
      clockAction.mutate({
        id: info.clock.id,
        expectedRevision: info.clock.revision,
        action,
      });
  };
  function saveDraft() {
    if (!draft) return;
    const breaks = Number(draft.breakMinutes),
      entered = Number(draft.hours);
    const parsed = entryInput.safeParse({
      ...draft,
      jobId: draft.jobId || null,
      minutes: Math.round(entered * 60) - breaks,
      breakMinutes: breaks,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Check the hours and break length.",
      );
      return;
    }
    saveEntry.mutate({
      entry: parsed.data,
      userId: person,
      expectedRevision: sheet?.revision ?? 0,
    });
  }
  function exportCsv() {
    const rows = (report.data ?? []).map((row) => ({
      Employee: row.employee ?? row.email,
      "Period start": row.periodStart,
      "Period end": row.periodEnd,
      Status: row.status,
      Date: row.date,
      Job: row.job,
      Category: row.category,
      Hours: hours(row.minutes),
      "Break minutes": row.breakMinutes,
      "Cost code": row.costCode,
      Notes: row.notes,
    }));
    const url = URL.createObjectURL(
      new Blob([timeCsv(rows)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `timesheets-${from}-${to}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 pb-20 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Timesheets</h1>
        {info && (
          <span className="text-muted-foreground text-sm">
            {cap(info.settings.cadence)} submissions
          </span>
        )}
      </div>
      {!online && (
        <p role="alert" className="rounded-md border p-3 text-sm">
          Reconnect to save time or change the clock. A running timer continues
          on the server.
        </p>
      )}
      {(contextError ?? error) && (
        <p role="alert" className="text-destructive text-sm">
          {error ?? contextError}
        </p>
      )}
      <nav
        className="flex gap-1 overflow-x-auto border-b pb-2"
        aria-label="Timesheet sections"
      >
        {[
          ["my", "My time"],
          ...(info?.canManage ? [["team", "Review"]] : []),
          ["reports", "Reports"],
          ["activity", "Activity"],
          ...(info?.canConfigure ? [["settings", "Company settings"]] : []),
        ].map(([id, text]) => (
          <Button
            key={id}
            variant={
              tab === id || (tab === "detail" && id === "team")
                ? "default"
                : "ghost"
            }
            onClick={() => chooseTab(id as typeof tab)}
          >
            {text}
          </Button>
        ))}
      </nav>
      {info?.canEdit && tab !== "settings" && (
        <section
          className="bg-card space-y-3 rounded-lg border p-4"
          aria-label="Your time clock"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold">
              <ClockIcon className="h-5 w-5" />
              Your time clock
            </h2>
            {info.clock && (
              <strong className="text-xl tabular-nums" aria-label="Worked time">
                {elapsedText}
              </strong>
            )}
          </div>
          {info.clock ? (
            <>
              <p className="text-sm">
                {info.clock.jobName} ·{" "}
                {paused ? "On unpaid break" : "Clocked in"} · started{" "}
                {new Date(info.clock.startedAt).toLocaleString()}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy || !online}
                  onClick={() => clockCommand(paused ? "resume" : "pause")}
                >
                  {paused ? "End break" : "Start break"}
                </Button>
                <Button
                  disabled={busy || !online}
                  onClick={() => clockCommand("stop")}
                >
                  Clock out & save
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || !online}
                  onClick={async () => {
                    if (
                      await confirmAction({
                        title: "Cancel this timer?",
                        description:
                          "No hours will be added. The cancellation is kept in the audit history.",
                        confirmLabel: "Cancel timer",
                        destructive: true,
                      })
                    )
                      clockCommand("cancel");
                  }}
                >
                  Cancel timer
                </Button>
              </div>
            </>
          ) : (
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <label className={label}>
                Job
                <select
                  className={field}
                  value={clockJob}
                  onChange={(e) => setClockJob(e.target.value)}
                >
                  <option value="">General / no job</option>
                  {info.jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Task or note
                <Input
                  maxLength={2000}
                  value={clockNote}
                  onChange={(e) => setClockNote(e.target.value)}
                  placeholder="What are you working on?"
                />
              </label>
              <Button
                disabled={busy || !online}
                onClick={() =>
                  start.mutate({ jobId: clockJob || null, notes: clockNote })
                }
              >
                Clock in
              </Button>
            </div>
          )}
        </section>
      )}
      {(tab === "my" || tab === "detail") && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-end gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous period"
                disabled={!selected}
                onClick={() => setDate(addDays(selected!.start, -1))}
              >
                <ChevronLeftIcon />
              </Button>
              <label className={label}>
                Date
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next period"
                disabled={!selected}
                onClick={() => setDate(addDays(selected!.end, 1))}
              >
                <ChevronRightIcon />
              </Button>
            </div>
            <Button
              disabled={!editable || !selected}
              onClick={() => {
                setError(null);
                setDraft({
                  id: crypto.randomUUID(),
                  date,
                  jobId: "",
                  category: "work",
                  hours: "8",
                  breakMinutes: "0",
                  costCode: "",
                  notes: "",
                });
              }}
            >
              <PlusIcon className="h-4 w-4" />
              Add time
            </Button>
          </div>
          {tab === "detail" && (
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                {info?.people.find((employee) => employee.id === person)
                  ?.name ??
                  info?.people.find((employee) => employee.id === person)
                    ?.email ??
                  "Employee timesheet"}
              </h2>
              <Button variant="ghost" onClick={() => chooseTab("team")}>
                Back to review
              </Button>
            </div>
          )}
          {detail.error && (
            <p role="alert" className="text-destructive">
              {detail.error.message}
            </p>
          )}
          {detail.isLoading ? (
            <p role="status">Loading period…</p>
          ) : (
            selected && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">
                      {selected.start}
                      {selected.end !== selected.start
                        ? ` — ${selected.end}`
                        : ""}
                    </h2>
                    <span
                      className={`text-sm ${statusClass[sheet?.status ?? "draft"]}`}
                    >
                      {cap(sheet?.status ?? "draft")}
                    </span>
                  </div>
                  <strong className="text-xl tabular-nums">
                    {hours(periodTotal)} hours
                  </strong>
                </div>
                {sheet?.reviewNote && (
                  <p className="rounded-md border p-3 text-sm">
                    Review note: {sheet.reviewNote}
                  </p>
                )}
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted">
                      <tr>
                        {[
                          "Date",
                          "Job / task",
                          "Type",
                          "Hours",
                          "Break",
                          "",
                        ].map((text) => (
                          <th
                            key={text}
                            className="px-3 py-2 font-medium whitespace-nowrap"
                          >
                            {text}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {selected.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {entry.date}
                          </td>
                          <td className="max-w-xs px-3 py-3">
                            <div className="font-medium">{entry.jobName}</div>
                            {entry.costCode && (
                              <div className="text-muted-foreground text-xs">
                                Code: {entry.costCode}
                              </div>
                            )}
                            <p className="text-muted-foreground text-xs break-words whitespace-pre-wrap">
                              {entry.notes}
                            </p>
                          </td>
                          <td className="px-3 py-3 capitalize">
                            {entry.category}
                            {entry.source === "timer" && (
                              <span className="text-muted-foreground block text-xs">
                                Timer
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 tabular-nums">
                            {hours(entry.minutes)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {entry.breakMinutes} min
                          </td>
                          <td className="px-2 py-3">
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={!editable}
                                aria-label={`Edit time on ${entry.date}`}
                                onClick={() => {
                                  setError(null);
                                  setDraft({
                                    id: entry.id,
                                    date: entry.date,
                                    jobId: entry.jobId ?? "",
                                    category:
                                      entry.category as Draft["category"],
                                    hours: String(
                                      (entry.minutes + entry.breakMinutes) / 60,
                                    ),
                                    breakMinutes: String(entry.breakMinutes),
                                    costCode: entry.costCode,
                                    notes: entry.notes,
                                  });
                                }}
                              >
                                <PencilIcon className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={!editable}
                                aria-label={`Delete time on ${entry.date}`}
                                onClick={async () => {
                                  if (
                                    sheetArgs &&
                                    (await confirmAction({
                                      title: "Delete this time entry?",
                                      description:
                                        "Its previous contents are kept in the audit history.",
                                      confirmLabel: "Delete entry",
                                      destructive: true,
                                    }))
                                  )
                                    remove.mutate({
                                      ...sheetArgs,
                                      entryId: entry.id,
                                    });
                                }}
                              >
                                <TrashIcon className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!selected.entries.length && (
                    <p className="text-muted-foreground p-5 text-center text-sm">
                      No time recorded for this period. Clock in or add an
                      entry.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {sheetArgs && editable && selected.entries.length > 0 && (
                    <Button
                      disabled={busy}
                      onClick={() => submit.mutate(sheetArgs)}
                    >
                      Submit for approval
                    </Button>
                  )}
                  {sheetArgs &&
                    sheet?.status === "submitted" &&
                    (info?.canEdit ?? info?.canManage) && (
                      <Button
                        variant="outline"
                        disabled={busy || !online}
                        onClick={() => withdraw.mutate(sheetArgs)}
                      >
                        Withdraw submission
                      </Button>
                    )}
                  {sheetArgs &&
                    info?.canManage &&
                    sheet?.status === "submitted" && (
                      <Button
                        disabled={busy || !online}
                        onClick={() =>
                          review.mutate({
                            ...sheetArgs,
                            decision: "approve",
                            note: "",
                          })
                        }
                      >
                        Approve
                      </Button>
                    )}
                  {sheetArgs &&
                    info?.canManage &&
                    ["submitted", "approved"].includes(sheet?.status ?? "") && (
                      <Button
                        variant="outline"
                        disabled={busy || !online}
                        onClick={() => setReturnReason("")}
                      >
                        Return for correction
                      </Button>
                    )}
                </div>
                {!!selected.events.length && (
                  <details className="rounded-lg border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Audit history
                    </summary>
                    <ul className="mt-3 space-y-2 text-sm">
                      {selected.events.map((event, index) => (
                        <li key={index}>
                          {event.action} · {event.actorName}
                          <span className="text-muted-foreground ml-2 text-xs">
                            {new Date(event.createdAt).toLocaleString()}
                          </span>
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs">
                              Details
                            </summary>
                            <AuditDetails data={event.data} />
                          </details>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )
          )}
        </>
      )}
      {tab === "activity" && (
        <section className="space-y-3">
          <h2 className="font-semibold">
            {info?.canManage ? "Company activity" : "Your activity"}
          </h2>
          {activity.error && <p role="alert">{activity.error.message}</p>}
          {activity.isLoading && <p role="status">Loading activity…</p>}
          <ul className="divide-y rounded-lg border">
            {activity.data?.map((event) => (
              <li key={event.id} className="p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>
                    {event.action} · {event.actorName}
                  </strong>
                  <time>{new Date(event.createdAt).toLocaleString()}</time>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer">Details</summary>
                  <AuditDetails data={event.data} />
                </details>
              </li>
            ))}
          </ul>
          {activity.data?.length === 0 && (
            <p className="text-muted-foreground">No activity yet.</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!offset || activity.isFetching}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={activity.data?.length !== 100 || activity.isFetching}
              onClick={() => setOffset(offset + 100)}
            >
              Next
            </Button>
          </div>
        </section>
      )}
      {(tab === "my" || tab === "team") && (
        <section className="space-y-3">
          <h2 className="font-semibold">
            {tab === "team" ? "Company timesheets" : "Recent timesheets"}
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            {rangeControls}
            {tab === "team" && (
              <label className={label}>
                Open employee timesheet
                <select
                  className={field}
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return;
                    setPerson(event.target.value);
                    setDate(info.today);
                    setTab("detail");
                  }}
                >
                  <option value="">Select an employee…</option>
                  {info.people.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name ?? employee.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab === "team" && (
              <label className={label}>
                Status
                <select
                  className={field}
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as typeof status);
                    setOffset(0);
                  }}
                >
                  {["submitted", "approved", "returned", "draft", "all"].map(
                    (value) => (
                      <option key={value} value={value}>
                        {cap(value)}
                      </option>
                    ),
                  )}
                </select>
              </label>
            )}
          </div>
          {list.error && (
            <p role="alert" className="text-destructive">
              {list.error.message}
            </p>
          )}
          {list.isLoading && <p role="status">Loading timesheets…</p>}
          <div className="divide-y rounded-lg border">
            {list.data?.map((item) => (
              <button
                key={item.id}
                type="button"
                className="hover:bg-accent flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm"
                onClick={() => {
                  setDate(item.startDate);
                  setPerson(tab === "team" ? item.userId : undefined);
                  setTab(tab === "team" ? "detail" : "my");
                }}
              >
                <span>
                  <strong>
                    {tab === "team"
                      ? (item.name ?? item.email)
                      : item.startDate}
                  </strong>
                  <span className="text-muted-foreground block">
                    {item.startDate}
                    {item.endDate !== item.startDate
                      ? ` — ${item.endDate}`
                      : ""}
                  </span>
                </span>
                <span className="text-right">
                  <strong className="tabular-nums">
                    {hours(item.minutes)} h
                  </strong>
                  <span className={`block ${statusClass[item.status]}`}>
                    {cap(item.status)}
                  </span>
                </span>
              </button>
            ))}
            {list.data?.length === 0 && (
              <p className="text-muted-foreground p-5 text-center text-sm">
                No timesheets match this date range.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Previous page
            </Button>
            <Button
              variant="outline"
              disabled={list.data?.length !== 100}
              onClick={() => setOffset(offset + 100)}
            >
              Next page
            </Button>
          </div>
        </section>
      )}
      {tab === "reports" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            {rangeControls}
            <label className={label}>
              Job
              <select
                className={field}
                value={reportJob}
                onChange={(e) => setReportJob(e.target.value)}
              >
                <option value="">All jobs</option>
                {info?.jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={approvedOnly}
                onChange={(e) => setApprovedOnly(e.target.checked)}
              />
              Approved only
            </label>
            <Button
              variant="outline"
              disabled={!report.data?.length || report.isFetching}
              onClick={exportCsv}
            >
              <DownloadIcon className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
          {report.error && (
            <p role="alert" className="text-destructive">
              {report.error.message}
            </p>
          )}
          {report.isLoading && <p role="status">Loading report…</p>}
          <p className="text-2xl font-bold tabular-nums">
            {hours(summaries.total)} hours{" "}
            <span className="text-muted-foreground text-sm font-normal">
              · {report.data?.length ?? 0} entries
            </span>
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { title: "By employee", rows: summaries.employees },
              { title: "By job", rows: summaries.jobs },
            ].map(({ title, rows }) => (
              <section key={title} className="rounded-lg border">
                <h3 className="border-b px-4 py-3 font-semibold">{title}</h3>
                <ul className="max-h-96 divide-y overflow-y-auto">
                  {rows.map((row, index) => (
                    <li
                      key={index}
                      className="flex justify-between gap-3 px-4 py-2 text-sm"
                    >
                      <span className="min-w-0 break-words">{row.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {hours(row.minutes)} h
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="text-muted-foreground text-sm">
            CSV exports include every matching entry, employee, job, category,
            unpaid break, cost code and note. Hours are recorded time; no wage
            or overtime rules are assumed.
          </p>
        </section>
      )}
      {tab === "settings" && info?.canConfigure && (
        <form
          className="max-w-xl space-y-4 rounded-lg border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = settingsInput.safeParse(settings);
            if (!parsed.success) {
              setError(
                parsed.error.issues[0]?.message ?? "Check the settings.",
              );
              return;
            }
            configure.mutate({
              ...parsed.data,
              expectedRevision: info.settings.revision,
            });
          }}
        >
          <h2 className="font-semibold">Company timesheet settings</h2>
          <label className={label}>
            Submission period
            <select
              className={field}
              value={settings.cadence}
              onChange={(e) =>
                setSettings((old) => ({
                  ...old,
                  cadence: e.target.value as typeof settings.cadence,
                }))
              }
            >
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </select>
          </label>
          {settings.cadence === "weekly" && (
            <label className={label}>
              Week begins
              <select
                className={field}
                value={settings.weekStartsOn}
                onChange={(e) =>
                  setSettings((old) => ({
                    ...old,
                    weekStartsOn: Number(e.target.value),
                  }))
                }
              >
                {[
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ].map((day, index) => (
                  <option value={index} key={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={label}>
            Company time zone
            <Input
              value={settings.timezone}
              onChange={(e) =>
                setSettings((old) => ({ ...old, timezone: e.target.value }))
              }
              placeholder="America/Toronto"
            />
          </label>
          <p className="text-muted-foreground text-sm">
            Existing periods keep their dates and approvals. New periods follow
            this setting once existing periods end. Clock entries split at
            midnight in this time zone; breaks are unpaid.
          </p>
          <Button type="submit" disabled={busy || !online}>
            {configure.isPending ? "Saving…" : "Save company settings"}
          </Button>
        </form>
      )}
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open && !saveEntry.isPending) setDraft(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Time entry</DialogTitle>
          </DialogHeader>
          {draft && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                saveDraft();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <label className={label}>
                  Date
                  <Input
                    type="date"
                    required
                    min={selected?.start}
                    max={selected?.end}
                    value={draft.date}
                    onChange={(e) =>
                      setDraft({ ...draft, date: e.target.value })
                    }
                  />
                </label>
                <label className={label}>
                  Type
                  <select
                    className={field}
                    value={draft.category}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        category: e.target.value as Draft["category"],
                      })
                    }
                  >
                    {timeCategories.map((type) => (
                      <option key={type} value={type}>
                        {cap(type)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className={label}>
                Job
                <select
                  className={field}
                  value={draft.jobId}
                  onChange={(e) =>
                    setDraft({ ...draft, jobId: e.target.value })
                  }
                >
                  <option value="">General / no job</option>
                  {info?.jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={label}>
                  Hours before unpaid break
                  <Input
                    type="number"
                    min="0.0167"
                    max="24"
                    step="any"
                    required
                    value={draft.hours}
                    onChange={(e) =>
                      setDraft({ ...draft, hours: e.target.value })
                    }
                  />
                </label>
                <label className={label}>
                  Unpaid break (minutes)
                  <Input
                    type="number"
                    min="0"
                    max="1440"
                    step="1"
                    required
                    value={draft.breakMinutes}
                    onChange={(e) =>
                      setDraft({ ...draft, breakMinutes: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className={label}>
                Cost code (optional)
                <Input
                  maxLength={100}
                  value={draft.costCode}
                  onChange={(e) =>
                    setDraft({ ...draft, costCode: e.target.value })
                  }
                />
              </label>
              <label className={label}>
                Notes
                <textarea
                  className={field}
                  rows={3}
                  maxLength={2000}
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft({ ...draft, notes: e.target.value })
                  }
                />
              </label>
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saveEntry.isPending}
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saveEntry.isPending || !online}>
                  {saveEntry.isPending ? "Saving…" : "Save time"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={returnReason !== null}
        onOpenChange={(open) => {
          if (!open && !review.isPending) setReturnReason(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return for correction</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (sheetArgs)
                review.mutate({
                  ...sheetArgs,
                  decision: "return",
                  note: returnReason ?? "",
                });
            }}
          >
            <label className={label}>
              What needs to be corrected?
              <textarea
                className={field}
                rows={3}
                maxLength={2000}
                required
                value={returnReason ?? ""}
                onChange={(e) => setReturnReason(e.target.value)}
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setReturnReason(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!returnReason?.trim() || busy}>
                Return timesheet
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditDetails({ data }: { data: unknown }) {
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const record = object(data);
  const names: Record<string, string> = {
    date: "Date",
    jobName: "Job",
    category: "Type",
    minutes: "Hours",
    breakMinutes: "Unpaid break (minutes)",
    costCode: "Cost code",
    notes: "Notes",
    note: "Review note",
    previousStatus: "Previous status",
    cadence: "Submissions",
    weekStartsOn: "Week begins",
    timezone: "Time zone",
    startDate: "Period start",
    endDate: "Period end",
    source: "Recorded with",
    nextMode: "Clock mode",
  };
  const groups = [
    { title: "Change", value: record },
    ...["before", "after", "entry"]
      .filter((key) => record[key])
      .map((key) => ({
        title: key === "entry" ? "Recorded time" : cap(key),
        value: object(record[key]),
      })),
  ];
  const intervals: unknown[] = Array.isArray(record.periods)
    ? record.periods
    : record.interval
      ? [record.interval]
      : [];
  return (
    <div className="mt-2 space-y-3 text-xs">
      {groups.map((group) => {
        const fields = Object.entries(group.value).filter(
          ([key, value]) =>
            key in names &&
            (typeof value === "string" || typeof value === "number"),
        );
        return fields.length ? (
          <div key={group.title}>
            <strong>{group.title}</strong>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {fields.map(([key, value]) => (
                <div className="contents" key={key}>
                  <dt className="text-muted-foreground">{names[key]}</dt>
                  <dd className="min-w-0 break-words whitespace-pre-wrap">
                    {key === "minutes" && typeof value === "number"
                      ? hours(value)
                      : key === "weekStartsOn" && typeof value === "number"
                        ? [
                            "Sunday",
                            "Monday",
                            "Tuesday",
                            "Wednesday",
                            "Thursday",
                            "Friday",
                            "Saturday",
                          ][value]
                        : typeof value === "string" || typeof value === "number"
                          ? String(value)
                          : ""}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null;
      })}
      {!!intervals.length && (
        <ul className="max-h-48 space-y-1 overflow-auto">
          {intervals.map((item, index) => {
            const interval = object(item);
            return (
              <li key={index}>
                {interval.kind === "break" ? "Unpaid break" : "Work"} ·{" "}
                {typeof interval.start === "string"
                  ? new Date(interval.start).toLocaleString()
                  : ""}{" "}
                →{" "}
                {typeof interval.end === "string"
                  ? new Date(interval.end).toLocaleString()
                  : "Running"}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
