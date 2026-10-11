import { sql } from "drizzle-orm";
import type { db as database } from "~/server/db";
import type { AppDeviceObservation } from "~/lib/app-devices";

type Database = Pick<typeof database, "execute">;
export type DeviceReport = Pick<
  AppDeviceObservation,
  "deviceId" | "deviceType" | "platform" | "mode" | "installButtonVisible"
>;
export async function recordAppDevice(
  db: Database,
  userId: string,
  report: DeviceReport,
) {
  await db.execute(sql`
    INSERT INTO kublai_app_device_observation
      ("userId", "deviceId", "deviceType", platform, mode, "installButtonVisible", "lastSeenAt", "installedAppLastSeenAt")
    SELECT ${userId}, ${report.deviceId}::uuid, ${report.deviceType}, ${report.platform}, ${report.mode}, ${report.installButtonVisible}, now(),
      CASE WHEN ${report.mode}='installed-app' THEN now() ELSE NULL END
    WHERE EXISTS (SELECT 1 FROM kublai_app_device_observation WHERE "userId"=${userId} AND "deviceId"=${report.deviceId}::uuid)
      OR (SELECT count(*) FROM kublai_app_device_observation WHERE "userId"=${userId}) < 32
    ON CONFLICT ("userId", "deviceId") DO UPDATE SET
      "deviceType"=excluded."deviceType", platform=excluded.platform, mode=excluded.mode,
      "installButtonVisible"=excluded."installButtonVisible", "lastSeenAt"=now(),
      "installedAppLastSeenAt"=coalesce(excluded."installedAppLastSeenAt", kublai_app_device_observation."installedAppLastSeenAt")
    WHERE kublai_app_device_observation."lastSeenAt" < now()-interval '2 minutes'
      OR kublai_app_device_observation.mode IS DISTINCT FROM excluded.mode
      OR kublai_app_device_observation."installButtonVisible" IS DISTINCT FROM excluded."installButtonVisible"
      OR kublai_app_device_observation.platform IS DISTINCT FROM excluded.platform
      OR kublai_app_device_observation."deviceType" IS DISTINCT FROM excluded."deviceType"
  `);
}
export async function organizationAppDevices(
  db: Database,
  organizationId: string,
) {
  const rows = await db.execute<AppDeviceObservation>(sql`
    SELECT d."userId", d."deviceId", d."deviceType", d.platform, d.mode, d."installButtonVisible",
      d."lastSeenAt"::text AS "lastSeenAt", d."installedAppLastSeenAt"::text AS "installedAppLastSeenAt"
    FROM kublai_app_device_observation d JOIN kublai_user u ON u.id=d."userId"
    WHERE u."organizationId"=${organizationId} ORDER BY d."lastSeenAt" DESC
  `);
  return Array.from(rows, (row) => ({
    ...row,
    lastSeenAt: new Date(row.lastSeenAt).toISOString(),
    installedAppLastSeenAt: row.installedAppLastSeenAt
      ? new Date(row.installedAppLastSeenAt).toISOString()
      : null,
  }));
}
