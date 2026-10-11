// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_DELIVERY_CALENDAR as defaults, deliveryCalendarSchema, nextDeliveryDate, dateInTimeZone } from "./delivery-calendar";
import { deliveryHolidays, scheduledDeliveryDate, validateDeliveryLocation } from "~/server/orders/delivery-calendar";

describe("order delivery dates", () => {
  it("keeps the existing next-weekday default", () => {
    expect(nextDeliveryDate(defaults, [], new Date("2026-10-09T15:00Z"))).toBe("2026-10-12");
  });
  it("allows weekends and skips any chosen weekday", () => {
    expect(nextDeliveryDate({ ...defaults, skippedWeekdays: [] }, [], new Date("2026-10-09T15:00Z"))).toBe("2026-10-10");
    expect(nextDeliveryDate({ ...defaults, skippedWeekdays: [0, 1, 2, 3, 4, 6] }, [], new Date("2026-10-09T15:00Z"))).toBe("2026-10-16");
    expect(deliveryCalendarSchema.safeParse({ ...defaults, skippedWeekdays: [0, 1, 2, 3, 4, 5, 6] }).success).toBe(false);
  });
  it("uses the user's calendar day near midnight and across daylight-saving changes", () => {
    const calendar = { ...defaults, timeZone: "America/Toronto" };
    expect(dateInTimeZone(new Date("2026-10-10T01:00Z"), calendar.timeZone)).toBe("2026-10-09");
    expect(nextDeliveryDate({ ...calendar, skippedWeekdays: [] }, [], new Date("2026-10-10T01:00Z"))).toBe("2026-10-10");
    expect(nextDeliveryDate(calendar, [], new Date("2026-03-07T22:00Z"))).toBe("2026-03-09");
  });
  it("skips Canadian Thanksgiving unless that holiday is allowed", () => {
    const calendar = { ...defaults, country: "CA", state: "ON" };
    const holidays = deliveryHolidays(calendar, 2026);
    const thanksgiving = holidays.find(h => h.date === "2026-10-12")!;
    expect(thanksgiving.name).toMatch(/Thanksgiving/);
    expect(scheduledDeliveryDate(calendar, new Date("2026-10-09T15:00Z"))).toBe("2026-10-13");
    expect(scheduledDeliveryDate({ ...calendar, allowedHolidays: [thanksgiving.key] }, new Date("2026-10-09T15:00Z"))).toBe("2026-10-12");
  });
  it("uses regional holidays and keeps holiday choices across years", () => {
    const national = deliveryHolidays({ country: "CA", state: null, region: null }, 2026);
    const ontario = deliveryHolidays({ country: "CA", state: "ON", region: null }, 2026);
    expect(national.some(h => h.name === "Family Day")).toBe(false);
    const family = ontario.find(h => h.name === "Family Day")!;
    expect(family).toBeDefined();
    expect(deliveryHolidays({ country: "CA", state: "ON", region: null }, 2027).find(h => h.name === "Family Day")?.key).toBe(family.key);
  });
  it("includes observed holidays around a year boundary", () => {
    const calendar = { ...defaults, country: "US" };
    expect(scheduledDeliveryDate(calendar, new Date("2026-12-31T15:00Z"))).toBe("2027-01-04");
    expect(scheduledDeliveryDate(calendar, new Date("2027-12-30T15:00Z"))).toBe("2028-01-03");
  });
  it("honours every day of a multi-day holiday and all holidays on a shared date", () => {
    const holidays = [{ key: "festival", name: "Festival", date: "2026-10-12", endDate: "2026-10-14", observed: false }, { key: "second", name: "Second holiday", date: "2026-10-12", endDate: "2026-10-12", observed: false }];
    const from = new Date("2026-10-11T12:00Z");
    expect(nextDeliveryDate(defaults, holidays, from)).toBe("2026-10-15");
    expect(nextDeliveryDate({ ...defaults, allowedHolidays: ["festival"] }, holidays, from)).toBe("2026-10-13");
    expect(nextDeliveryDate({ ...defaults, allowedHolidays: ["festival", "second"] }, holidays, from)).toBe("2026-10-12");
  });
  it("does not let an allowed holiday override a skipped weekday", () => {
    const holiday = { key: "day", name: "Day", date: "2026-10-10", endDate: "2026-10-10", observed: false };
    expect(nextDeliveryDate({ ...defaults, allowedHolidays: ["day"] }, [holiday], new Date("2026-10-09T15:00Z"))).toBe("2026-10-12");
  });
  it("rejects unknown countries, unrelated regions and invalid time zones", () => {
    expect(() => validateDeliveryLocation({ ...defaults, country: "ZZ" })).toThrow();
    expect(() => validateDeliveryLocation({ ...defaults, country: "CA", state: "California" })).toThrow();
    expect(deliveryCalendarSchema.safeParse({ ...defaults, timeZone: "Wrong/Zone" }).success).toBe(false);
  });
});
