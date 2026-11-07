import { sql } from "drizzle-orm";
import type { db as database } from "~/server/db";
import type { MemberNotificationStatus } from "~/lib/member-notifications";

type Counts = Omit<MemberNotificationStatus, "state"> & { userId: string };

/** Only aggregate counts are returned; endpoints, keys and chat content stay private. */
export async function memberNotificationCounts(
  db: Pick<typeof database, "execute">,
  organizationId: string,
) {
  const rows = await db.execute<Counts>(sql`
    with members as (
      select id from kublai_user where "organizationId"=${organizationId}
    ), devices as (
      select s."userId", count(*)::int as devices,
        count(*) filter (where s."deviceType"='phone')::int as phones,
        count(*) filter (where s."deviceType"='tablet')::int as tablets,
        count(*) filter (where s."deviceType"='computer')::int as computers,
        count(*) filter (where s."deviceType"='unknown')::int as "unknownDevices"
      from kublai_chat_push_subscription s join members m on m.id=s."userId" group by s."userId"
    ), delivery as (
      select o."recipientId", o."completedAt", o.outcome
      from kublai_chat_push_outbox o join members m on m.id=o."recipientId"
      where o."organizationId"=${organizationId} and o."createdAt">now()-interval '7 days'
      union all
      select o."recipientId", o."completedAt", o.outcome
      from kublai_conversation_push_outbox o join members m on m.id=o."recipientId"
      where o."organizationId"=${organizationId} and o."createdAt">now()-interval '7 days'
      union all
      select n."recipientId", o."completedAt", o.outcome
      from kublai_drawing_push_outbox o join kublai_drawing_notification n on n.id=o."notificationId"
      join kublai_job_drawing_sheet s on s.id=n."sheetId"
      join members m on m.id=n."recipientId"
      where s."organizationId"=${organizationId} and o."createdAt">now()-interval '7 days'
    ), sent as (
      select "recipientId", count(*) filter(where "completedAt" is null)::int as pending,
        count(*) filter(where outcome='failed')::int as failed,
        (max("completedAt") filter(where outcome='sent'))::text as "lastSentAt"
      from delivery group by "recipientId"
    ), muted as (
      select c."userId", count(*)::int as "mutedJobs"
      from kublai_job_chat_member c join kublai_job j on j.id=c."jobId"
      join members m on m.id=c."userId"
      where j."organizationId"=${organizationId} and c.muted group by c."userId"
    ) select m.id as "userId", coalesce(d.devices,0)::int as devices,
      coalesce(d.phones,0)::int as phones, coalesce(d.tablets,0)::int as tablets,
      coalesce(d.computers,0)::int as computers, coalesce(d."unknownDevices",0)::int as "unknownDevices",
      coalesce(muted."mutedJobs",0)::int as "mutedJobs", coalesce(sent.pending,0)::int as pending,
      coalesce(sent.failed,0)::int as failed, sent."lastSentAt"
    from members m left join devices d on d."userId"=m.id
    left join sent on sent."recipientId"=m.id left join muted on muted."userId"=m.id
  `);
  return new Map(
    Array.from(rows, (row) => [
      row.userId,
      {
        devices: row.devices,
        phones: row.phones,
        tablets: row.tablets,
        computers: row.computers,
        unknownDevices: row.unknownDevices,
        mutedJobs: row.mutedJobs,
        pending: row.pending,
        failed: row.failed,
        lastSentAt: row.lastSentAt
          ? new Date(row.lastSentAt).toISOString()
          : null,
      },
    ]),
  );
}

export function memberNotificationStatus(
  counts: Omit<MemberNotificationStatus, "state"> | undefined,
  eligible: boolean,
  configured: boolean,
): MemberNotificationStatus {
  const values = counts ?? {
    devices: 0,
    phones: 0,
    tablets: 0,
    computers: 0,
    unknownDevices: 0,
    mutedJobs: 0,
    pending: 0,
    failed: 0,
    lastSentAt: null,
  };
  return {
    ...values,
    state: !eligible
      ? "access-blocked"
      : !configured
        ? "server-unavailable"
        : values.devices
          ? "ready"
          : "not-enabled",
  };
}
