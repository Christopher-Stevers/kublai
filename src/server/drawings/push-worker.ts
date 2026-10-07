import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db as database } from "~/server/db";
import type { DrawingEntity } from "~/lib/drawing-workspace";
import type { PushRecipient } from "~/server/chat/push-policy";
import { MAX_PUSH_ATTEMPTS, pushFailure } from "~/server/chat/push-policy";
import { sendPushPayload } from "~/server/chat/push-transport";
import {
  drawingPushPayload,
  eligibleDrawingRecipient,
} from "./notification-policy";
type Configuration = { publicKey: string; privateKey: string; subject: string };
type Dependencies = {
  db: typeof database;
  configuration: Configuration | null;
  send?: typeof sendPushPayload;
};
type Delivery = {
  id: string;
  leaseToken: string;
  attempts: number;
  notificationId: string;
  subscriptionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  recipientId: string;
};
type Candidate = {
  user: PushRecipient;
  organizationId: string;
  senderId: string;
  entity: DrawingEntity;
  watching: boolean;
  subscriptionUserId: string;
  readAt: string | null;
  reviewDecided: boolean;
  jobId: string;
  setId: string;
  sheetId: string;
};
async function productionDependencies(): Promise<Dependencies> {
  const [{ db }, { getPushConfiguration }] = await Promise.all([
    import("~/server/db"),
    import("~/server/chat/push"),
  ]);
  return { db, configuration: getPushConfiguration() };
}
export async function drainDrawingPush(options?: Dependencies) {
  const {
    db,
    configuration,
    send = sendPushPayload,
  } = options ?? (await productionDependencies());
  await db.execute(
    sql`delete from kublai_drawing_notification where "createdAt"<now()-interval '30 days'`,
  );
  await db.execute(
    sql`delete from kublai_drawing_push_outbox where "completedAt"<now()-interval '7 days'`,
  );
  await db.execute(sql`update kublai_drawing_push_outbox set "completedAt"=now(),outcome='expired',"leaseToken"=null,"leasedUntil"=null
    where "completedAt" is null and ("createdAt"<now()-interval '1 day' or attempts>=${MAX_PUSH_ATTEMPTS}) and ("leasedUntil" is null or "leasedUntil"<now())`);
  if (!configuration) return;
  const leaseToken = randomUUID();
  const deliveries = await db.execute<Delivery>(sql`
    with picked as (select id from kublai_drawing_push_outbox where "completedAt" is null and "availableAt"<=now()
      and ("leasedUntil" is null or "leasedUntil"<now()) and attempts<${MAX_PUSH_ATTEMPTS}
      order by "availableAt",id limit 8 for update skip locked),
    claimed as (update kublai_drawing_push_outbox o set "leaseToken"=${leaseToken},"leasedUntil"=now()+interval '2 minutes',attempts=attempts+1
      from picked where o.id=picked.id returning o.*)
    select c.*,s.endpoint,s.p256dh,s.auth,n."recipientId" from claimed c
    join kublai_chat_push_subscription s on s.id=c."subscriptionId" join kublai_drawing_notification n on n.id=c."notificationId"`);
  async function settle(delivery: Delivery, outcome: string, retryMs?: number) {
    await db.execute(sql`update kublai_drawing_push_outbox set "completedAt"=${retryMs === undefined ? sql`now()` : sql`null`},outcome=${outcome},
      "availableAt"=now()+(${retryMs ?? 0}*interval '1 millisecond'),"leaseToken"=null,"leasedUntil"=null where id=${delivery.id} and "leaseToken"=${delivery.leaseToken}`);
  }
  await Promise.allSettled(
    deliveries.map(async (delivery) => {
      const [current] = await db.execute<Candidate>(sql`
      select to_jsonb(u) as "user",s."organizationId",s."jobId",s."setId",s.id as "sheetId",n."senderId",n."readAt",e.entity,
        sub."userId" as "subscriptionUserId",(w."userId" is not null) as watching,
        (exists(select 1 from kublai_drawing_workspace_entity d where d."sheetId"=s.id and d.entity->>'kind'='review' and d.entity->'data'->>'requestId'=e.id::text)
          or (e.entity->>'kind'='review' and coalesce(m.data->>'currentSourceSheetId',s.id::text)<>e.entity->'data'->>'sourceSheetId')) as "reviewDecided"
      from kublai_drawing_push_outbox o join kublai_drawing_notification n on n.id=o."notificationId"
      join kublai_chat_push_subscription sub on sub.id=o."subscriptionId" and sub."userId"=n."recipientId"
      join kublai_user u on u.id=n."recipientId" join kublai_job_drawing_sheet s on s.id=n."sheetId" and s."organizationId"=u."organizationId"
      join kublai_drawing_workspace_entity e on e.id=n."entityId" and e."sheetId"=s.id
      left join kublai_drawing_workspace_watch w on w."sheetId"=s.id and w."userId"=u.id
      left join kublai_drawing_workspace_metadata m on m."sheetId"=s.id
      where o.id=${delivery.id} and o."leaseToken"=${delivery.leaseToken} and o."leasedUntil">now()
        and sub.endpoint=${delivery.endpoint} and sub.p256dh=${delivery.p256dh} and sub.auth=${delivery.auth}`);
      if (!current || !eligibleDrawingRecipient(current)) {
        await settle(delivery, "skipped");
        return;
      }
      try {
        await send(
          delivery,
          configuration,
          drawingPushPayload(
            current.jobId,
            current.setId,
            current.sheetId,
            current.user.id,
          ),
        );
        await settle(delivery, "sent");
      } catch (error) {
        const failure = pushFailure(error, delivery.attempts);
        if (failure.outcome === "expired")
          await db.execute(
            sql`delete from kublai_chat_push_subscription where id=${delivery.subscriptionId} and "userId"=${delivery.recipientId} and endpoint=${delivery.endpoint}`,
          );
        else
          await settle(
            delivery,
            failure.outcome,
            failure.permanent ? undefined : failure.retryMs,
          );
      }
    }),
  );
}
const state = globalThis as typeof globalThis & {
  drawingPushTimer?: NodeJS.Timeout;
  drawingPushRunning?: boolean;
};
export function startDrawingPushWorker() {
  if (state.drawingPushTimer) return;
  const run = async () => {
    if (state.drawingPushRunning) return;
    state.drawingPushRunning = true;
    try {
      await drainDrawingPush();
    } catch {
      console.warn(
        "Drawing notification delivery paused; pending deliveries will retry.",
      );
    } finally {
      state.drawingPushRunning = false;
    }
  };
  state.drawingPushTimer = setInterval(() => void run(), 15000);
  state.drawingPushTimer.unref();
  void run();
}
