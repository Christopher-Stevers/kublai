import { z } from "zod";

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export const deliveryCalendarSchema = z.object({
  skippedWeekdays: z
    .array(z.number().int().min(0).max(6))
    .max(6)
    .refine(
      (days) => new Set(days).size === days.length,
      "Choose each weekday only once.",
    ),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  state: z.string().min(1).max(40).nullable(),
  region: z.string().min(1).max(40).nullable(),
  allowedHolidays: z.array(z.string().min(1).max(1000)).max(500),
  timeZone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid time zone."),
});
export type DeliveryCalendar = z.infer<typeof deliveryCalendarSchema>;
export const DEFAULT_DELIVERY_CALENDAR: DeliveryCalendar = {
  skippedWeekdays: [0, 6],
  country: null,
  state: null,
  region: null,
  allowedHolidays: [],
  timeZone: "UTC",
};
export type DeliveryHoliday = {
  key: string;
  name: string;
  date: string;
  endDate: string;
  observed: boolean;
};

export function dateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function nextDeliveryDate(
  calendar: DeliveryCalendar,
  holidays: DeliveryHoliday[],
  from = new Date(),
): string {
  // Work in calendar dates, so daylight-saving changes never move a delivery day.
  const day = new Date(`${dateInTimeZone(from, calendar.timeZone)}T00:00:00Z`);
  const skipped = new Set(calendar.skippedWeekdays);
  if (skipped.size >= 7)
    throw new Error("Keep at least one delivery weekday enabled.");
  const allowed = new Set(calendar.allowedHolidays);
  const blocked = holidays.filter((h) => !allowed.has(h.key));
  for (let i = 0; i < 732; i++) {
    day.setUTCDate(day.getUTCDate() + 1);
    const date = day.toISOString().slice(0, 10);
    if (
      !skipped.has(day.getUTCDay()) &&
      !blocked.some((h) => h.date <= date && date <= h.endDate)
    )
      return date;
  }
  throw new Error(
    "No delivery day is available in the next two years. Update your delivery calendar.",
  );
}
export function formatDeliveryDate(
  date: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  },
) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-CA", {
    ...options,
    timeZone: "UTC",
  });
}
