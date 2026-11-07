import {
  pgTableCreator,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./schema";
import type { AppDeviceType, AppDevicePlatform } from "~/lib/app-devices";
const table = pgTableCreator((name) => `kublai_${name}`);
export const appDeviceObservations = table(
  "app_device_observation",
  (d) => ({
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => (users as unknown as { id: AnyPgColumn }).id, {
        onDelete: "cascade",
      }),
    deviceId: d.uuid().notNull(),
    deviceType: d.varchar({ length: 16 }).$type<AppDeviceType>().notNull(),
    platform: d.varchar({ length: 16 }).$type<AppDevicePlatform>().notNull(),
    mode: d
      .varchar({ length: 16 })
      .$type<"browser" | "installed-app">()
      .notNull(),
    installButtonVisible: d.boolean().notNull(),
    lastSeenAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
    installedAppLastSeenAt: d.timestamp({ withTimezone: true }),
  }),
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] })],
);
