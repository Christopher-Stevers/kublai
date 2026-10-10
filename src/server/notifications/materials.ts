import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db as database } from "~/server/db";
import { userCan } from "~/server/auth/permissions";
import type { PushRecipient } from "~/server/chat/push-policy";

export function eligibleMaterialRecipient(
  user: PushRecipient,
  organizationId: string,
  senderId: string,
) {
  return (
    user.id !== senderId &&
    user.organizationId === organizationId &&
    user.organizationAccessStatus === "approved" &&
    userCan(user, "tab.dashboard")
  );
}

/** Called inside the edit transaction, after an actual material change. */
export async function enqueueMaterialNotification(
  tx: Pick<typeof database, "execute">,
  input: {
    organizationId: string;
    materialListId: string;
    senderId: string;
    action: "added" | "edited";
    eventKey?: string;
  },
) {
  const people = await tx.execute<{ user: PushRecipient }>(sql`
    select to_jsonb(manager) as "user" from kublai_organization_reporting_line r
    join kublai_user manager on manager.id=r."reportsToUserId" and manager."organizationId"=r."organizationId"
    join kublai_user sender on sender.id=r."userId" and sender."organizationId"=r."organizationId"
    join kublai_material_list l on l.id=${input.materialListId}::uuid and l."organizationId"=r."organizationId" and l.kind='materials'
    where r."organizationId"=${input.organizationId}::uuid and r."userId"=${input.senderId}`);
  const recipients = people.filter(({ user }) =>
    eligibleMaterialRecipient(user, input.organizationId, input.senderId),
  );
  if (!recipients.length) return;
  const eventKey = input.eventKey ?? randomUUID();
  const values = sql.join(
    recipients.map(
      ({ user }) =>
        sql`(${input.organizationId}::uuid,${input.materialListId}::uuid,${input.senderId},${user.id},${eventKey},${input.action})`,
    ),
    sql`, `,
  );
  await tx.execute(sql`with inserted as (
    insert into kublai_material_notification ("organizationId","materialListId","senderId","recipientId","eventKey",action)
    values ${values} on conflict do nothing returning id,"recipientId"
  ) insert into kublai_material_push_outbox ("notificationId","subscriptionId")
    select n.id,s.id from inserted n cross join lateral
      (select id from kublai_chat_push_subscription where "userId"=n."recipientId" order by id limit 20) s
    on conflict do nothing`);
}

export function materialPushPayload(
  materialListId: string,
  recipientId: string,
) {
  return JSON.stringify({
    type: "material-list",
    url: `/dashboard/material-lists/${materialListId}`,
    account: createHash("sha256").update(recipientId).digest("hex"),
  });
}
