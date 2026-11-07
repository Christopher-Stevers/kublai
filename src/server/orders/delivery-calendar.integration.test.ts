// @vitest-environment node
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as statement } from "drizzle-orm";
import { expect, it } from "vitest";
import { readDeliveryCalendar, saveDeliveryCalendar } from "./delivery-calendar";
import { DEFAULT_DELIVERY_CALENDAR as defaults } from "~/lib/delivery-calendar";

it("persists each user's calendar and rejects stale saves without touching real account data", async () => {
  const url = dotenv.parse(readFileSync(".env")).DATABASE_URL;
  const sql = postgres(url!, { max: 1 });
  try {
    await drizzle(sql).transaction(async tx => {
      // PostgreSQL resolves this transaction-local temporary table first.
      await tx.execute(statement`CREATE TEMP TABLE kublai_order_delivery_preferences ("userId" varchar(255) PRIMARY KEY, calendar jsonb NOT NULL, revision integer NOT NULL DEFAULT 1, "updatedAt" timestamptz NOT NULL DEFAULT now()) ON COMMIT DROP`);
      const database = tx as unknown as Parameters<typeof readDeliveryCalendar>[0];
      expect(await readDeliveryCalendar(database, "calendar-test-a")).toEqual({ calendar: defaults, revision: 0 });
      const calendar = { ...defaults, skippedWeekdays: [1, 2] };
      expect(await saveDeliveryCalendar(database, "calendar-test-a", calendar, 0)).toEqual({ calendar, revision: 1 });
      expect(await readDeliveryCalendar(database, "calendar-test-a")).toEqual({ calendar, revision: 1 });
      expect(await readDeliveryCalendar(database, "calendar-test-b")).toEqual({ calendar: defaults, revision: 0 });
      await expect(saveDeliveryCalendar(database, "calendar-test-a", defaults, 0)).rejects.toThrow(/another device/);
      expect((await saveDeliveryCalendar(database, "calendar-test-a", defaults, 1)).revision).toBe(2);
      await expect(saveDeliveryCalendar(database, "calendar-test-a", calendar, 1)).rejects.toThrow(/another device/);
      expect((await readDeliveryCalendar(database, "calendar-test-a")).calendar).toEqual(defaults);
      await expect(saveDeliveryCalendar(database, "missing", calendar, 5)).rejects.toThrow(/another device/);
    });
  } finally { await sql.end(); }
});
