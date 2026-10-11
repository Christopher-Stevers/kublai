import Holidays from "date-holidays";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { db } from "~/server/db";
import { orderDeliveryPreferences } from "~/server/db/schema";
import {
  DEFAULT_DELIVERY_CALENDAR,
  dateInTimeZone,
  deliveryCalendarSchema,
  nextDeliveryDate,
  type DeliveryCalendar,
  type DeliveryHoliday,
} from "~/lib/delivery-calendar";

const catalog = new Holidays();
const choices = (values: Record<string, string> | undefined) =>
  Object.entries(values ?? {})
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
export const deliveryCountries = choices(catalog.getCountries("en"));
export function deliveryLocations(
  country: string | null,
  state: string | null,
) {
  return {
    states: country ? choices(catalog.getStates(country, "en")) : [],
    regions:
      country && state ? choices(catalog.getRegions(country, state, "en")) : [],
  };
}
export function validateDeliveryLocation(calendar: DeliveryCalendar) {
  if (!calendar.country) {
    if (calendar.state || calendar.region || calendar.allowedHolidays.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose a country before selecting holidays or a region.",
      });
    return;
  }
  if (!deliveryCountries.some((c) => c.code === calendar.country))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Country holiday data is unavailable.",
    });
  const locations = deliveryLocations(calendar.country, calendar.state);
  if (
    calendar.state &&
    !locations.states.some((s) => s.code === calendar.state)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a state or province in this country.",
    });
  if (
    calendar.region &&
    !locations.regions.some((r) => r.code === calendar.region)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a region in this state or province.",
    });
}
const cache = new Map<string, DeliveryHoliday[]>();
export function deliveryHolidays(
  calendar: Pick<DeliveryCalendar, "country" | "state" | "region">,
  year: number,
): DeliveryHoliday[] {
  if (!calendar.country) return [];
  const key = JSON.stringify([
    calendar.country,
    calendar.state,
    calendar.region,
    year,
  ]);
  const cached = cache.get(key);
  if (cached) return cached;
  const engine = new Holidays(
    {
      country: calendar.country,
      state: calendar.state ?? undefined,
      region: calendar.region ?? undefined,
    },
    { languages: "en", timezone: "UTC", types: ["public"] },
  );
  const dates = engine.getHolidays(year).map((h) => ({
    key: `${h.rule}${h.substitute ? "#observed" : ""}`,
    name: h.name,
    date: h.date.slice(0, 10),
    endDate: new Date(h.end.getTime() - 1).toISOString().slice(0, 10),
    observed: Boolean(h.substitute),
  }));
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(key, dates);
  return dates;
}
export async function readDeliveryCalendar(
  database: typeof db,
  userId: string,
) {
  const [row] = await database
    .select()
    .from(orderDeliveryPreferences)
    .where(eq(orderDeliveryPreferences.userId, userId))
    .limit(1);
  return {
    calendar: row
      ? deliveryCalendarSchema.parse(row.calendar)
      : { ...DEFAULT_DELIVERY_CALENDAR },
    revision: row?.revision ?? 0,
  };
}
export async function saveDeliveryCalendar(
  database: typeof db,
  userId: string,
  calendar: DeliveryCalendar,
  expectedRevision: number,
) {
  validateDeliveryLocation(calendar);
  const [row] =
    expectedRevision === 0
      ? await database
          .insert(orderDeliveryPreferences)
          .values({ userId, calendar, revision: 1 })
          .onConflictDoNothing()
          .returning()
      : await database
          .update(orderDeliveryPreferences)
          .set({
            calendar,
            revision: sql`${orderDeliveryPreferences.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            sql`${orderDeliveryPreferences.userId} = ${userId} and ${orderDeliveryPreferences.revision} = ${expectedRevision}`,
          )
          .returning();
  if (!row)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Your delivery calendar changed on another device. Reload it before saving.",
    });
  return {
    calendar: deliveryCalendarSchema.parse(row.calendar),
    revision: row.revision,
  };
}
export function scheduledDeliveryDate(
  calendar: DeliveryCalendar,
  from = new Date(),
) {
  const year = Number(dateInTimeZone(from, calendar.timeZone).slice(0, 4));
  // Include adjacent years: observed New Year's holidays can fall in December.
  const holidays = [year - 1, year, year + 1, year + 2].flatMap((y) =>
    deliveryHolidays(calendar, y),
  );
  return nextDeliveryDate(calendar, holidays, from);
}
export async function userDeliveryDate(
  database: typeof db,
  userId: string,
  from = new Date(),
) {
  const { calendar } = await readDeliveryCalendar(database, userId);
  return scheduledDeliveryDate(calendar, from);
}
