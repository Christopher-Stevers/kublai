import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type {
  DrawingEntity,
  DrawingNotification,
} from "~/lib/drawing-workspace";
import type { db as database } from "~/server/db";
import {
  drawingNotifications,
  drawingPushOutbox,
} from "~/server/db/drawing-workspace-schema";
import type { PushRecipient } from "~/server/chat/push-policy";
import {
  drawingNotificationReason,
  drawingNotificationUrl,
  eligibleDrawingRecipient,
} from "./notification-policy";
type Transaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
type Context = { db: typeof database; userId: string };
export async function enqueueDrawingNotifications(
  tx: Transaction,
  input: {
    sheetId: string;
    organizationId: string;
    senderId: string;
    entity: DrawingEntity;
  },
) {
  if (input.entity.visibility !== "published") return;
  const assigneeId =
    input.entity.kind === "issue"
      ? input.entity.data.assigneeId
      : input.entity.kind === "review" && input.entity.data.status === "pending"
        ? input.entity.data.reviewerId
        : null;
  const people = await tx.execute<{
    user: PushRecipient;
    watching: boolean;
  }>(sql`
    select to_jsonb(u) as "user", (w."userId" is not null) as watching from kublai_user u
    left join kublai_drawing_workspace_watch w on w."userId"=u.id and w."sheetId"=${input.sheetId}
    where u."organizationId"=${input.organizationId} and u.id<>${input.senderId}
      and (w."userId" is not null or u.id=${assigneeId}) limit 2001`);
  if (people.length > 2000)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "This drawing has too many notification recipients.",
    });
  const values = people
    .filter((person) => eligibleDrawingRecipient({ ...person, ...input }))
    .map((person) => ({
      sheetId: input.sheetId,
      entityId: input.entity.id,
      revision: input.entity.revision,
      senderId: input.senderId,
      recipientId: person.user.id,
      reason: drawingNotificationReason(
        input.entity,
        person.user.id,
        person.watching,
      )!,
    }));
  if (!values.length) return;
  const rows = await tx
    .insert(drawingNotifications)
    .values(values)
    .onConflictDoNothing()
    .returning({
      id: drawingNotifications.id,
      recipientId: drawingNotifications.recipientId,
    });
  if (!rows.length) return;
  const notificationIds = sql.join(
    rows.map((row) => sql`${row.id}::uuid`),
    sql`, `,
  );
  const recipientIds = sql.join(
    rows.map((row) => sql`${row.recipientId}`),
    sql`, `,
  );
  await tx.execute(sql`insert into ${drawingPushOutbox} ("notificationId", "subscriptionId")
    select n.id, s.id from ${drawingNotifications} n cross join lateral
      (select id from kublai_chat_push_subscription where "userId"=n."recipientId" order by id limit 20) s
    where n.id in (${notificationIds}) on conflict do nothing`);
  await tx.execute(sql`delete from ${drawingNotifications} where id in (
    select id from (select id,row_number() over (partition by "recipientId" order by "createdAt" desc,id desc) as rank
      from ${drawingNotifications} where "recipientId" in (${recipientIds})) bounded where rank>2000)`);
}
export async function drawingNotificationInbox(
  ctx: Context,
  jobId?: string,
): Promise<DrawingNotification[]> {
  const rows = await ctx.db.execute<{
    id: string;
    jobId: string;
    sheetId: string;
    setId: string;
    entityId: string;
    revision: number;
    reason: DrawingNotification["reason"];
    createdAt: string;
    readAt: string | null;
    senderId: string;
    user: PushRecipient;
    organizationId: string;
    entity: DrawingEntity;
    watching: boolean;
    reviewDecided: boolean;
  }>(sql`
    select n.*, s."jobId",s."setId",s."organizationId",to_jsonb(u) as "user", e.entity,
      (w."userId" is not null) as watching,
      exists (select 1 from kublai_drawing_workspace_entity decision where decision."sheetId"=s.id and decision.entity->>'kind'='review' and decision.entity->'data'->>'requestId'=e.id::text) as "reviewDecided"
    from kublai_drawing_notification n join kublai_user u on u.id=n."recipientId"
    join kublai_job_drawing_sheet s on s.id=n."sheetId" and s."organizationId"=u."organizationId"
    join kublai_drawing_workspace_entity e on e.id=n."entityId" and e."sheetId"=s.id
    left join kublai_drawing_workspace_watch w on w."sheetId"=s.id and w."userId"=u.id
    where n."recipientId"=${ctx.userId} ${jobId ? sql`and s."jobId"=${jobId}` : sql``}
    order by n."createdAt" desc,n.id desc limit 500`);
  return rows
    .filter((row) => eligibleDrawingRecipient({ ...row, readAt: null }))
    .slice(0, 200)
    .map((row) => ({
      id: row.id,
      jobId: row.jobId,
      sheetId: row.sheetId,
      setId: row.setId,
      entityId: row.entityId,
      revision: row.revision,
      reason: row.reason,
      createdAt: new Date(row.createdAt).toISOString(),
      readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
      url: drawingNotificationUrl(row.jobId, row.setId, row.sheetId),
    }));
}
export async function readDrawingNotification(ctx: Context, id: string) {
  await ctx.db
    .update(drawingNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(drawingNotifications.id, id),
        eq(drawingNotifications.recipientId, ctx.userId),
      ),
    );
  return { ok: true as const };
}
