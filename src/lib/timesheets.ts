import { z } from "zod";

export const timeCategories = [
  "work",
  "training",
  "travel",
  "vacation",
  "sick",
  "holiday",
  "other",
] as const;
export const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value &&
      value >= "2000-01-01" &&
      value <= "2100-12-31"
    );
  }, "Choose a valid date.");
export const settingsInput = z.object({
  cadence: z.enum(["daily", "weekly"]),
  weekStartsOn: z.number().int().min(0).max(6),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    }, "Enter a valid time zone, such as America/Toronto."),
});
export const defaultTimeSettings = {
  cadence: "weekly" as const,
  weekStartsOn: 1,
  timezone: "America/Toronto",
};
export type TimeSettings = z.infer<typeof settingsInput>;
export type ClockPeriod = {
  start: string;
  end: string | null;
  kind: "work" | "break";
};
export const entryInput = z
  .object({
    id: z.string().uuid(),
    date: dateInput,
    jobId: z.string().uuid().nullable(),
    category: z.enum(timeCategories),
    minutes: z.number().int().min(1).max(1440),
    breakMinutes: z.number().int().min(0).max(1440),
    costCode: z.string().trim().max(100),
    notes: z.string().trim().max(2000),
  })
  .refine(
    (entry) => entry.minutes + entry.breakMinutes <= 1440,
    "A time entry cannot exceed 24 hours including breaks.",
  );
export function addDays(date: string, count: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}
export function timePeriod(date: string, settings: TimeSettings) {
  const offset =
    settings.cadence === "daily"
      ? 0
      : (new Date(`${date}T00:00:00Z`).getUTCDay() -
          settings.weekStartsOn +
          7) %
        7;
  const start = addDays(date, -offset);
  return {
    start,
    end: settings.cadence === "daily" ? start : addDays(start, 6),
  };
}
export function localDate(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}
/** Split real elapsed time at company-local midnight, including DST transitions. */
export function clockDays(periods: ClockPeriod[], now: Date, timezone: string) {
  const days = new Map<string, { work: number; breaks: number }>();
  for (const period of periods) {
    let cursor = new Date(period.start).getTime();
    const end = new Date(period.end ?? now).getTime();
    if (!Number.isFinite(cursor) || !Number.isFinite(end) || end < cursor)
      throw Error("Invalid timer interval");
    if (end - cursor > 32 * 86400000)
      throw Error(
        "This timer has run for over a month. Cancel it and enter the correct hours manually.",
      );
    while (cursor < end) {
      const date = localDate(new Date(cursor), timezone);
      let boundary = end;
      if (localDate(new Date(end - 1), timezone) !== date) {
        let low = cursor,
          high = Math.min(end, cursor + 27 * 3600000);
        while (high - low > 1) {
          const mid = Math.floor((low + high) / 2);
          if (localDate(new Date(mid), timezone) === date) low = mid;
          else high = mid;
        }
        boundary = high;
      }
      const totals = days.get(date) ?? { work: 0, breaks: 0 };
      totals[period.kind === "work" ? "work" : "breaks"] +=
        (boundary - cursor) / 60000;
      days.set(date, totals);
      cursor = boundary;
    }
  }
  return [...days]
    .map(([date, totals]) => ({
      date,
      minutes: Math.round(totals.work),
      breakMinutes: Math.round(totals.breaks),
    }))
    .filter((day) => day.minutes > 0);
}
export const hours = (minutes: number) => (minutes / 60).toFixed(2);
export function timeCsv(rows: Record<string, string | number>[]) {
  const headers = [
    "Employee",
    "Period start",
    "Period end",
    "Status",
    "Date",
    "Job",
    "Category",
    "Hours",
    "Break minutes",
    "Cost code",
    "Notes",
  ];
  const cell = (value: string | number | undefined) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    "\ufeff" +
    [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
