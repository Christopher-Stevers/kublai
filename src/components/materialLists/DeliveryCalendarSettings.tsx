"use client";
import { useState } from "react";
import { CalendarDaysIcon, ChevronDownIcon } from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { SwitchTrack } from "~/components/ui/switch";
import {
  formatDeliveryDate,
  WEEKDAYS,
  type DeliveryCalendar,
} from "~/lib/delivery-calendar";

export function DeliveryCalendarSettings({
  online,
  onSaved,
}: {
  online: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [draft, setDraft] = useState<{
    calendar: DeliveryCalendar;
    userId: string;
    revision: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const utils = api.useUtils();
  const saved = api.orderDelivery.get.useQuery(undefined, {
    enabled: open && online,
  });
  const activeDraft = draft?.userId === saved.data?.userId ? draft : null;
  const calendar = activeDraft?.calendar ?? saved.data?.calendar;
  const preview = api.orderDelivery.preview.useQuery(
    { calendar: calendar!, year },
    { enabled: open && online && Boolean(calendar), staleTime: 60_000 },
  );
  const save = api.orderDelivery.save.useMutation({
    onSuccess: (value) => {
      const userId = activeDraft?.userId ?? saved.data!.userId;
      utils.orderDelivery.get.setData(undefined, { ...value, userId });
      setDraft(null);
      setError("");
      setStatus("Delivery calendar saved.");
      void utils.materialList.previewOrders.invalidate();
      void utils.materialList.getOrderEmailContent.invalidate();
      onSaved();
    },
    onError: (reason) => setError(reason.message),
  });
  const change = (next: DeliveryCalendar) => {
    if (!saved.data) return;
    setError("");
    setStatus("");
    setDraft({
      calendar: {
        ...next,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      userId: saved.data.userId,
      revision: activeDraft?.revision ?? saved.data.revision,
    });
  };
  const disabled = !online || save.isPending;
  const selectClass =
    "bg-background h-10 w-full rounded-md border px-3 text-sm disabled:opacity-50";
  return (
    <section className="mb-6 rounded-xl border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="delivery-calendar-settings"
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left font-medium"
      >
        <CalendarDaysIcon aria-hidden="true" className="text-primary size-5" />
        <span className="flex-1">Delivery calendar</span>
        <ChevronDownIcon
          aria-hidden="true"
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          id="delivery-calendar-settings"
          className="space-y-5 border-t px-4 py-4"
        >
          {!online ? (
            <p role="status" className="text-muted-foreground text-sm">
              Reconnect to edit your delivery calendar.
            </p>
          ) : saved.error ? (
            <div>
              <p role="alert" className="text-destructive text-sm">
                {saved.error.message}
              </p>
              <Button variant="ghost" onClick={() => void saved.refetch()}>
                Try again
              </Button>
            </div>
          ) : !calendar ? (
            <div role="status" aria-label="Loading delivery calendar" className="space-y-2">
              {Array.from({ length: 2 }, (_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <>
              <fieldset disabled={disabled}>
                <legend className="mb-2 text-sm font-medium">
                  Skip weekdays
                </legend>
                <div className="divide-y">
                  {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                    <button
                      key={day}
                      type="button"
                      role="switch"
                      aria-checked={calendar.skippedWeekdays.includes(day)}
                      aria-label={`Skip ${WEEKDAYS[day]}`}
                      disabled={disabled}
                      className="flex min-h-11 w-full items-center justify-between gap-3 py-2 disabled:opacity-50"
                      onClick={() => {
                        const skipped = calendar.skippedWeekdays.includes(day);
                        if (!skipped && calendar.skippedWeekdays.length === 6) {
                          setError(
                            "Keep at least one delivery weekday enabled.",
                          );
                          return;
                        }
                        change({
                          ...calendar,
                          skippedWeekdays: skipped
                            ? calendar.skippedWeekdays.filter((d) => d !== day)
                            : [...calendar.skippedWeekdays, day],
                        });
                      }}
                    >
                      <span className="text-sm">{WEEKDAYS[day]}</span>
                      <SwitchTrack
                        checked={calendar.skippedWeekdays.includes(day)}
                      />
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-3 border-t pt-4">
                <label className="block space-y-1 text-sm font-medium">
                  Country
                  <select
                    aria-label="Holiday country"
                    value={calendar.country ?? ""}
                    disabled={disabled || !preview.data}
                    className={selectClass}
                    onChange={(e) =>
                      change({
                        ...calendar,
                        country: e.target.value || null,
                        state: null,
                        region: null,
                        allowedHolidays: [],
                      })
                    }
                  >
                    <option value="">No holiday calendar</option>
                    {preview.data?.countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {Boolean(preview.data?.states.length) && (
                  <label className="block space-y-1 text-sm font-medium">
                    Province / state
                    <select
                      aria-label="Holiday province or state"
                      value={calendar.state ?? ""}
                      disabled={disabled}
                      className={selectClass}
                      onChange={(e) =>
                        change({
                          ...calendar,
                          state: e.target.value || null,
                          region: null,
                          allowedHolidays: [],
                        })
                      }
                    >
                      <option value="">National holidays only</option>
                      {preview.data?.states.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {Boolean(preview.data?.regions.length) && (
                  <label className="block space-y-1 text-sm font-medium">
                    Region
                    <select
                      aria-label="Holiday region"
                      value={calendar.region ?? ""}
                      disabled={disabled}
                      className={selectClass}
                      onChange={(e) =>
                        change({
                          ...calendar,
                          region: e.target.value || null,
                          allowedHolidays: [],
                        })
                      }
                    >
                      <option value="">State / province holidays only</option>
                      {preview.data?.regions.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {calendar.country && (
                <div className="space-y-3 border-t pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">Holiday deliveries</h3>
                    <select
                      aria-label="Holiday year"
                      className={`${selectClass} w-24`}
                      value={year}
                      onChange={(e) => setYear(Number(e.target.value))}
                    >
                      {[0, 1, 2].map((offset) => (
                        <option
                          key={offset}
                          value={new Date().getFullYear() + offset}
                        >
                          {new Date().getFullYear() + offset}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    On allows deliveries on that holiday each year. Weekday
                    skips still apply.
                  </p>
                  {preview.isFetching ? (
                    <p role="status" className="text-sm">
                      Loading holidays…
                    </p>
                  ) : preview.data?.holidays.length ? (
                    <div className="divide-y">
                      {preview.data.holidays.map((holiday, index) => (
                        <button
                          key={`${holiday.key}:${holiday.date}:${index}`}
                          type="button"
                          role="switch"
                          aria-label={`Allow deliveries on ${holiday.name}, ${formatDeliveryDate(holiday.date, { month: "long", day: "numeric" })}`}
                          aria-checked={calendar.allowedHolidays.includes(
                            holiday.key,
                          )}
                          disabled={disabled}
                          className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left disabled:opacity-50"
                          onClick={() =>
                            change({
                              ...calendar,
                              allowedHolidays:
                                calendar.allowedHolidays.includes(holiday.key)
                                  ? calendar.allowedHolidays.filter(
                                      (key) => key !== holiday.key,
                                    )
                                  : [...calendar.allowedHolidays, holiday.key],
                            })
                          }
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">
                              {holiday.name}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {formatDeliveryDate(holiday.date, {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })}
                              {holiday.endDate !== holiday.date &&
                                ` – ${formatDeliveryDate(holiday.endDate, { month: "short", day: "numeric" })}`}
                            </span>
                          </span>
                          <SwitchTrack
                            checked={calendar.allowedHolidays.includes(
                              holiday.key,
                            )}
                          />
                        </button>
                      ))}
                    </div>
                  ) : (
                    !preview.error && (
                      <p className="text-muted-foreground text-sm">
                        No public holidays listed for this selection.
                      </p>
                    )
                  )}
                </div>
              )}
              {preview.error && (
                <p role="alert" className="text-destructive text-sm">
                  {preview.error.message}
                </p>
              )}
              {preview.data && !preview.isFetching && (
                <p className="text-sm">
                  Next delivery:{" "}
                  <strong>{formatDeliveryDate(preview.data.nextDate)}</strong>
                </p>
              )}
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              {status && (
                <p role="status" className="text-sm">
                  {status}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={
                    disabled ||
                    !activeDraft ||
                    preview.isFetching ||
                    Boolean(preview.error)
                  }
                  onClick={() =>
                    activeDraft &&
                    save.mutate({
                      calendar: activeDraft.calendar,
                      expectedUserId: activeDraft.userId,
                      expectedRevision: activeDraft.revision,
                    })
                  }
                >
                  {save.isPending ? "Saving…" : "Save calendar"}
                </Button>
                {activeDraft && (
                  <Button
                    variant="ghost"
                    disabled={save.isPending}
                    onClick={() => {
                      setDraft(null);
                      setError("");
                    }}
                  >
                    Discard changes
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                Applies to your order emails. Dates use {calendar.timeZone}.
                Holiday choices repeat each year.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
