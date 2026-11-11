import { randomUUID } from "node:crypto";
import { transactionalBackgroundHint } from "~/server/background/hints";
import { sql } from "drizzle-orm";
import type { db } from "~/server/db";
import {
  defaultMaterialSortSettings,
  materialSortSettingsSchema,
  type MaterialSortSettings,
} from "~/lib/material-sort-preferences";
export async function readMaterialSortPreferences(
  database: typeof db,
  organizationId: string,
  userId: string,
) {
  const rows = await database.execute<{
    scope: string;
    settings: unknown;
    custom: boolean;
  }>(
    sql`select scope, settings, custom from kublai_material_sort_preference where organization_id=${organizationId}::uuid and scope in ('executive', ${userId})`,
  );
  const sharedRow = rows.find((row) => row.scope === "executive");
  const personalRow = rows.find((row) => row.scope === userId);
  return {
    shared:
      materialSortSettingsSchema.safeParse(sharedRow?.settings).data ??
      defaultMaterialSortSettings,
    personal:
      materialSortSettingsSchema.safeParse(personalRow?.settings).data ?? null,
    custom: personalRow?.custom ?? false,
    initialized: !!sharedRow,
  };
}
export async function saveMaterialSortPreferences(
  database: typeof db,
  organizationId: string,
  scope: string,
  settings: MaterialSortSettings,
  custom: boolean,
  initializeOnly = false,
) {
  const conflict = initializeOnly
    ? sql`do nothing`
    : sql`do update set settings=excluded.settings, custom=excluded.custom`;
  const payload = transactionalBackgroundHint({
    topic: "preferences",
    organizationId,
    scope: scope === "executive" ? "executive" : "personal",
    ...(scope === "executive" ? {} : { userId: scope }),
    eventId: randomUUID(),
  });
  await database.transaction(async (transaction) => {
    const changed = await transaction.execute(
      sql`insert into kublai_material_sort_preference (organization_id, scope, settings, custom) values (${organizationId}::uuid, ${scope}, ${JSON.stringify(settings)}::jsonb, ${custom}) on conflict (organization_id, scope) ${conflict} returning scope`,
    );
    // PostgreSQL releases NOTIFY only after this transaction commits. A no-op
    // initializeOnly seed has no returning row and produces no invalidation.
    if (changed.length)
      await transaction.execute(
        sql`select pg_notify('foremanhq_change', ${payload})`,
      );
  });
}
