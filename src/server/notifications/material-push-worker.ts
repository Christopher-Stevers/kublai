import { pushSettler, deliverAuthorizedPush, startPushWorker } from "~/server/push/worker";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db as database } from "~/server/db";
import type { PushRecipient } from "~/server/chat/push-policy";
import { MAX_PUSH_ATTEMPTS } from "~/server/chat/push-policy";
import { sendPushPayload } from "~/server/chat/push-transport";
import { materialPushPayload, eligibleMaterialRecipient } from "./materials";
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
  materialListId: string;
  action: string;
  itemCount: number;
};
async function productionDependencies(): Promise<Dependencies> {
  const [{ db }, { getPushConfiguration }] = await Promise.all([
    import("~/server/db"),
    import("~/server/chat/push"),
  ]);
  return { db, configuration: getPushConfiguration() };
}
export async function drainMaterialPush(options?: Dependencies) {
  const {
    db,
    configuration,
    send = sendPushPayload,
  } = options ?? (await productionDependencies());
  await db.execute(
    sql`delete from kublai_material_notification where "createdAt"<now()-interval '30 days'`,
  );
  await db.execute(
    sql`delete from kublai_material_push_outbox where "completedAt"<now()-interval '7 days'`,
  );
  await db.execute(sql`update kublai_material_push_outbox set "completedAt"=now(),outcome='expired',"leaseToken"=null,"leasedUntil"=null
    where "completedAt" is null and ("createdAt"<now()-interval '1 day' or attempts>=${MAX_PUSH_ATTEMPTS}) and ("leasedUntil" is null or "leasedUntil"<now())`);
  // Keep only the latest pending addition per sender; the next push carries the total.
  await db.execute(sql`update kublai_material_push_outbox o set "completedAt"=now(),outcome='superseded'
    from kublai_material_notification n where o."notificationId"=n.id and o."completedAt" is null
      and (o."leasedUntil" is null or o."leasedUntil"<now()) and n.action='added' and n."readAt" is null
      and exists (select 1 from kublai_material_notification newer where newer."organizationId"=n."organizationId"
        and newer."recipientId"=n."recipientId" and newer."senderId"=n."senderId" and newer.action='added'
        and newer."readAt" is null and (newer."createdAt",newer.id)>(n."createdAt",n.id))`);
  if (!configuration) return;
  const leaseToken = randomUUID();
  const deliveries = await db.execute<Delivery>(sql`
    with picked as (select id from kublai_material_push_outbox where "completedAt" is null and "availableAt"<=now()
      and ("leasedUntil" is null or "leasedUntil"<now()) and attempts<${MAX_PUSH_ATTEMPTS}
      order by "availableAt",id limit 8 for update skip locked),
    claimed as (update kublai_material_push_outbox o set "leaseToken"=${leaseToken},"leasedUntil"=now()+interval '2 minutes',attempts=attempts+1
      from picked where o.id=picked.id returning o.*)
    select c.*,s.endpoint,s.p256dh,s.auth,n."recipientId" from claimed c
    join kublai_chat_push_subscription s on s.id=c."subscriptionId" join kublai_material_notification n on n.id=c."notificationId"`);
  const settle = pushSettler(db, "kublai_material_push_outbox");
  await Promise.allSettled(
    deliveries.map(async (delivery) => {
      const [current] = await db.execute<Candidate>(sql`
        select to_jsonb(u) as "user",n."organizationId",n."senderId",n."materialListId",n.action,
          (select count(*)::int from kublai_material_notification additions where additions."organizationId"=n."organizationId"
            and additions."recipientId"=n."recipientId" and additions."senderId"=n."senderId" and additions.action='added' and additions."readAt" is null) as "itemCount"
        from kublai_material_push_outbox o
        join kublai_material_notification n on n.id=o."notificationId" and n."readAt" is null
        join kublai_material_list l on l.id=n."materialListId" and l."organizationId"=n."organizationId"
        join kublai_chat_push_subscription sub on sub.id=o."subscriptionId" and sub."userId"=n."recipientId"
        join kublai_user u on u.id=n."recipientId" and u."organizationId"=n."organizationId"
        join kublai_user sender on sender.id=n."senderId" and sender."organizationId"=n."organizationId"
        join kublai_organization_department d on d."organizationId"=n."organizationId" and lower(btrim(d.name))=lower(btrim(sender.department))
        join kublai_organization_department_lead lead on lead."organizationId"=d."organizationId" and lead."departmentId"=d.id and lead."userId"=n."recipientId"
        where o.id=${delivery.id} and o."leaseToken"=${delivery.leaseToken} and o."leasedUntil">now()
          and sub.endpoint=${delivery.endpoint} and sub.p256dh=${delivery.p256dh} and sub.auth=${delivery.auth}`);
      if (
        !current ||
        !eligibleMaterialRecipient(
          current.user,
          current.organizationId,
          current.senderId,
        )
      ) {
        await settle(delivery, "skipped");
        return;
      }
      await deliverAuthorizedPush(db, delivery, settle, async () => {
        await send(
          delivery,
          configuration,
          materialPushPayload(
            current.materialListId,
            current.user.id,
            current.action === "added"
              ? { senderId: current.senderId, count: current.itemCount }
              : undefined,
          ),
        );
      });
    }),
  );
}
export function startMaterialPushWorker() {
  startPushWorker("material", drainMaterialPush, "Material notification delivery paused; pending deliveries will retry.");
}
