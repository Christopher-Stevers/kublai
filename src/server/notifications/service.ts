import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  AppNotification,
  NotificationReadTarget,
  notificationCursor,
} from "~/lib/app-notifications";
import type { db as database } from "~/server/db";
import { userCan } from "~/server/auth/permissions";
import type { RequestUser } from "~/server/utils/get-request-identity";

type Context = {
  db: Pick<typeof database, "execute">;
  user: RequestUser;
  userId: string;
};

export function notificationAccount(user: RequestUser | null) {
  return user?.organizationId &&
    user.organizationAccessStatus === "approved" &&
    userCan(user, "tab.dashboard")
    ? `${user.id}:${user.organizationId}`
    : null;
}

export function assertNotificationAccount(
  user: RequestUser,
  accountKey: string,
) {
  const current = notificationAccount(user);
  if (!current) throw new TRPCError({ code: "FORBIDDEN" });
  if (current !== accountKey)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Your account changed. Refresh notifications.",
    });
}

function jobMembership(ctx: Context) {
  return sql`(member."userId" is not null or j."createdByUserId"=${ctx.user.id}
    or j."foremanUserId"=${ctx.user.id} or j.id=${ctx.user.currentJobId}::uuid)`;
}

export async function jobNotificationSettings(ctx: Context) {
  const jobs = await ctx.db.execute<{
    id: string;
    name: string;
    muted: boolean;
  }>(sql`select j.id,j.name,coalesce(member.muted,false) as muted
    from kublai_job j left join kublai_job_chat_member member
      on member."jobId"=j.id and member."userId"=${ctx.user.id}
    where j."organizationId"=${ctx.user.organizationId} and ${jobMembership(ctx)}
    order by lower(j.name),j.id`);
  return { accountKey: notificationAccount(ctx.user)!, jobs: Array.from(jobs) };
}

export async function setJobNotificationSettings(
  ctx: Context,
  jobId: string,
  muted: boolean,
) {
  const rows = await ctx.db
    .execute(sql`insert into kublai_job_chat_member ("jobId","userId",muted)
    select j.id,${ctx.user.id},${muted} from kublai_job j
    left join kublai_job_chat_member member on member."jobId"=j.id and member."userId"=${ctx.user.id}
    where j.id=${jobId}::uuid and j."organizationId"=${ctx.user.organizationId} and ${jobMembership(ctx)}
    on conflict ("jobId","userId") do update set muted=excluded.muted returning "jobId"`);
  if (!rows.length)
    throw new TRPCError({ code: "NOT_FOUND", message: "Job chat not found." });
  return { muted };
}

// Each source rechecks current access. Chat alerts follow membership (including
// job owners/foremen/current job) and mute/read cursors, independently of device
// push subscriptions. Drawing alerts follow current visibility and recipients.
// This shared projection keeps the count, history and read actions consistent.
function sources(ctx: Context) {
  const user = ctx.user;
  return sql`notifications as (
    select 'drawing:' || n.id::text as id, 'drawing'::text as kind,
      n.id as "sourceId", null::bigint as sequence,
      case n.reason when 'assignment' then 'Drawing assignment'
        when 'review' then 'Drawing review requested' else 'Drawing updated' end as title,
      j.name || ' · ' || s.name as context,
      left(coalesce(e.entity->'data'->>'title', e.entity->'data'->>'label', 'New drawing activity'), 240) as description,
      n."createdAt", n."readAt" is null as unread,
      '/dashboard/jobs/' || s."jobId" || '/drawings?drawingSet=' || s."setId" || '&drawingSheet=' || s.id as url
    from kublai_drawing_notification n
    join kublai_job_drawing_sheet s on s.id=n."sheetId" and s."organizationId"=${user.organizationId}
    join kublai_job j on j.id=s."jobId" and j."organizationId"=s."organizationId"
    join kublai_drawing_workspace_entity e on e.id=n."entityId" and e."sheetId"=s.id
    left join kublai_drawing_workspace_watch w on w."sheetId"=s.id and w."userId"=${user.id}
    where n."recipientId"=${user.id} and n."senderId"<>${user.id}
      and e.entity->>'visibility'='published'
      and ((e.entity->>'kind'='issue' and e.entity->'data'->>'assigneeId'=${user.id})
        or (e.entity->>'kind'='review' and e.entity->'data'->>'status'='pending'
          and e.entity->'data'->>'reviewerId'=${user.id}) or w."userId" is not null)
      and not exists (select 1 from kublai_drawing_workspace_entity decision
        where decision."sheetId"=s.id and decision.entity->>'kind'='review'
          and decision.entity->'data'->>'requestId'=e.id::text)
    union all
    select 'job-chat:' || m.id::text, 'job-chat', j.id, m.sequence,
      coalesce(a.name, 'Former member') || ' in job chat', j.name,
      left(case when m.body='' then 'Shared an attachment' else m.body end, 240),
      m."createdAt", m.sequence>coalesce(member."lastReadSequence",0),
      '/dashboard/jobs/' || j.id || '/chat'
    from kublai_job_chat_message m
    join kublai_job j on j.id=m."jobId" and j."organizationId"=${user.organizationId}
    left join kublai_job_chat_member member on member."jobId"=j.id and member."userId"=${user.id}
    left join kublai_user a on a.id=m."authorId"
    where m."deletedAt" is null and m."authorId" is distinct from ${user.id}
      and (member."userId" is not null or j."createdByUserId"=${user.id}
        or j."foremanUserId"=${user.id} or j.id=${user.currentJobId}::uuid)
      and not coalesce(member.muted,false)
    union all
    select 'conversation:' || m.id::text, 'conversation', c.id, m.sequence,
      coalesce(a.name,'Former member') || case c.kind when 'group' then ' in group chat' else ' sent you a message' end,
      case c.kind when 'group' then c.name else coalesce((select coalesce(p.name,p.email)
        from kublai_conversation_member other join kublai_user p on p.id=other."userId"
        where other."conversationId"=c.id and other."userId"<>${user.id} order by p.id limit 1),'Private chat') end,
      left(case when m.body='' then 'Shared an attachment' else m.body end,240),
      m."createdAt", m.sequence>member."lastReadSequence",
      '/dashboard/chat?conversation=' || c.id
    from kublai_conversation_message m
    join kublai_conversation c on c.id=m."conversationId" and c."organizationId"=${user.organizationId}
    join kublai_conversation_member member on member."conversationId"=c.id and member."userId"=${user.id}
    left join kublai_user a on a.id=m."authorId"
    where m."deletedAt" is null and m."authorId" is distinct from ${user.id}
  )`;
}

export async function notificationOverview(ctx: Context) {
  const [row] = await ctx.db.execute<{
    unreadCount: number;
    readTargets: NotificationReadTarget[];
  }>(sql`with ${sources(ctx)}, targets as (
    select kind,"sourceId" as id,max(sequence) as sequence from notifications
    where unread group by kind,"sourceId"
  ) select (select count(*)::int from notifications where unread) as "unreadCount",
    coalesce((select jsonb_agg(jsonb_strip_nulls(to_jsonb(targets))) from targets),'[]'::jsonb) as "readTargets"`);
  return {
    accountKey: notificationAccount(ctx.user)!,
    unreadCount: row?.unreadCount ?? 0,
    readTargets: row?.readTargets ?? [],
  };
}

export async function notificationPage(
  ctx: Context,
  input: {
    unreadOnly: boolean;
    limit: number;
    cursor?: z.infer<typeof notificationCursor> | null;
  },
) {
  type Row = Omit<AppNotification, "target"> & {
    sourceId: string;
    sequence: string | number | null;
  };
  const rows = await ctx.db.execute<Row>(sql`with ${sources(ctx)}
    select id,kind,title,context,description,unread,url,"sourceId",sequence,
      to_char("createdAt" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"
    from notifications where true ${input.unreadOnly ? sql`and unread` : sql``}
      ${input.cursor ? sql`and ("createdAt",id)<(${input.cursor.createdAt}::timestamptz,${input.cursor.id})` : sql``}
    order by "createdAt" desc,id desc limit ${input.limit + 1}`);
  const items = rows.slice(0, input.limit).map(
    ({ sourceId, sequence, ...row }): AppNotification => ({
      ...row,
      target: {
        kind: row.kind,
        id: sourceId,
        ...(sequence === null ? {} : { sequence: Number(sequence) }),
      },
    }),
  );
  const last = items.at(-1);
  return {
    accountKey: notificationAccount(ctx.user)!,
    items,
    nextCursor:
      rows.length > input.limit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

export async function readNotifications(
  ctx: Context,
  targets: NotificationReadTarget[],
) {
  // Watermarks come from a displayed snapshot. New messages and alerts arriving
  // while the window is open remain unread. GREATEST preserves reads elsewhere.
  // The source join prevents forged targets from crossing current access bounds.
  await ctx.db.execute(sql`with ${sources(ctx)}, requested as (
    select * from jsonb_to_recordset(${JSON.stringify(targets)}::jsonb) as t(kind text,id uuid,sequence bigint)
  ), selected as (
    select n.kind,n."sourceId",max(n.sequence) as sequence from notifications n
    join requested r on r.kind=n.kind and r.id=n."sourceId"
      and (n.kind='drawing' or n.sequence<=r.sequence)
    group by n.kind,n."sourceId"
  ), drawing_reads as (
    update kublai_drawing_notification n set "readAt"=coalesce(n."readAt",now())
    from selected s where s.kind='drawing' and n.id=s."sourceId" and n."recipientId"=${ctx.user.id} returning n.id
  ), job_reads as (
    insert into kublai_job_chat_member ("jobId","userId","lastReadSequence")
    select "sourceId",${ctx.user.id},sequence from selected where kind='job-chat'
    on conflict ("jobId","userId") do update set "lastReadSequence"=greatest(kublai_job_chat_member."lastReadSequence",excluded."lastReadSequence")
    returning "jobId"
  ) update kublai_conversation_member m set "lastReadSequence"=greatest(m."lastReadSequence",s.sequence)
    from selected s where s.kind='conversation' and m."conversationId"=s."sourceId" and m."userId"=${ctx.user.id}`);
  return { ok: true as const };
}
