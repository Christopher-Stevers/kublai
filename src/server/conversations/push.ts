import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "~/server/db";
import { conversationPushOutbox } from "~/server/db/conversation-schema";
import { getPushConfiguration } from "~/server/chat/push";
import { sendPushPayload } from "~/server/chat/push-transport";
import type { ChatTransaction } from "~/server/chat/types";
import {
  MAX_PUSH_ATTEMPTS,
  pushFailure,
  type PushRecipient,
} from "~/server/chat/push-policy";

import {
  conversationPushPayload,
  eligibleForConversationPush,
} from "./push-policy";

type Candidate = {
  subscriptionId: string;
  subscriptionUserId: string;
  user: PushRecipient;
  member: { lastReadSequence: number } | null;
};
type DeliveryCandidate = Candidate & {
  kind: "direct" | "group";
  chatName: string | null;
  senderName: string | null;
  body: string | null;
};
export async function enqueueConversationPush(
  tx: ChatTransaction,
  message: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    senderId: string;
    sequence: number;
  },
) {
  const candidates = await tx.execute<Candidate>(sql`
    SELECT s.id AS "subscriptionId", s."userId" AS "subscriptionUserId", to_jsonb(u) AS "user",
      jsonb_build_object('lastReadSequence',m."lastReadSequence") AS member
    FROM kublai_chat_push_subscription s JOIN kublai_user u ON u.id=s."userId"
    JOIN kublai_conversation c ON c.id=${message.conversationId} AND c."organizationId"=u."organizationId"
    JOIN kublai_conversation_member m ON m."conversationId"=c.id AND m."userId"=u.id
    WHERE u."organizationId"=${message.organizationId} AND u.id<>${message.senderId}
  `);
  const values = candidates
    .filter((candidate) =>
      eligibleForConversationPush({ ...message, ...candidate }),
    )
    .map((candidate) => ({
      ...message,
      subscriptionId: candidate.subscriptionId,
      recipientId: candidate.user.id,
    }));
  if (values.length)
    await tx
      .insert(conversationPushOutbox)
      .values(values)
      .onConflictDoNothing();
}

type Delivery = {
  id: string;
  leaseToken: string;
  attempts: number;
  conversationId: string;
  organizationId: string;
  messageId: string;
  senderId: string;
  recipientId: string;
  sequence: number;
  subscriptionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

async function sendToProvider(
  delivery: Delivery,
  configuration: NonNullable<ReturnType<typeof getPushConfiguration>>,
  preview: DeliveryCandidate,
) {
  return sendPushPayload(
    delivery,
    configuration,
    conversationPushPayload(
      delivery.conversationId,
      delivery.recipientId,
      preview,
    ),
  );
}

async function settle(delivery: Delivery, outcome: string, retryMs?: number) {
  await db.execute(sql`UPDATE kublai_conversation_push_outbox SET
    "completedAt"=${retryMs === undefined ? sql`now()` : sql`NULL`}, outcome=${outcome},
    "availableAt"=now()+(${retryMs ?? 0} * interval '1 millisecond'), "leasedUntil"=NULL, "leaseToken"=NULL
    WHERE id=${delivery.id} AND "leaseToken"=${delivery.leaseToken}`);
}

async function deliver(
  delivery: Delivery,
  configuration: NonNullable<ReturnType<typeof getPushConfiguration>>,
) {
  // Read access, subscription ownership, read position, membership and deleted message again at delivery time.
  const [current] = await db.execute<DeliveryCandidate>(sql`
    SELECT s."userId" AS "subscriptionUserId", to_jsonb(u) AS "user",
      jsonb_build_object('lastReadSequence',m."lastReadSequence") AS member,
      c.kind AS "kind", c.name AS "chatName", msg.body AS "body",
      (SELECT a.name FROM kublai_user a WHERE a.id=msg."authorId") AS "senderName"
    FROM kublai_conversation_push_outbox o JOIN kublai_chat_push_subscription s ON s.id=o."subscriptionId"
    JOIN kublai_user u ON u.id=o."recipientId"
    JOIN kublai_conversation c ON c.id=o."conversationId" AND c."organizationId"=o."organizationId"
    JOIN kublai_conversation_message msg ON msg.id=o."messageId" AND msg."conversationId"=c.id AND msg."deletedAt" IS NULL
    JOIN kublai_conversation_member m ON m."conversationId"=c.id AND m."userId"=u.id
    WHERE o.id=${delivery.id} AND o."leaseToken"=${delivery.leaseToken} AND o."leasedUntil">now()
      AND s."userId"=o."recipientId" AND s.endpoint=${delivery.endpoint} AND s.p256dh=${delivery.p256dh} AND s.auth=${delivery.auth}
  `);
  if (!current || !eligibleForConversationPush({ ...delivery, ...current })) {
    await settle(delivery, "skipped");
    return;
  }
  try {
    await sendToProvider(delivery, configuration, current);
    await settle(delivery, "sent");
  } catch (error) {
    const failure = pushFailure(error, delivery.attempts);
    if (failure.outcome === "expired") {
      await db.execute(
        sql`DELETE FROM kublai_chat_push_subscription WHERE id=${delivery.subscriptionId} AND "userId"=${delivery.recipientId} AND endpoint=${delivery.endpoint}`,
      );
    } else
      await settle(
        delivery,
        failure.outcome,
        failure.permanent ? undefined : failure.retryMs,
      );
  }
}

/** Multiple Node processes can drain safely; leases recover work after process termination. */
export async function drainConversationPush() {
  const configuration = getPushConfiguration();
  if (!configuration) return;
  await db.execute(sql`UPDATE kublai_conversation_push_outbox SET "completedAt"=now(), outcome='expired', "leaseToken"=NULL, "leasedUntil"=NULL
    WHERE "completedAt" IS NULL AND ("createdAt"<now()-interval '1 day' OR attempts>=${MAX_PUSH_ATTEMPTS})
      AND ("leasedUntil" IS NULL OR "leasedUntil"<now())`);
  const leaseToken = randomUUID();
  const deliveries = await db.execute<Delivery>(sql`
    WITH picked AS (
      SELECT id FROM kublai_conversation_push_outbox WHERE "completedAt" IS NULL AND "availableAt"<=now()
        AND ("leasedUntil" IS NULL OR "leasedUntil"<now()) AND attempts<${MAX_PUSH_ATTEMPTS}
      ORDER BY "availableAt",id LIMIT 8 FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE kublai_conversation_push_outbox o SET "leaseToken"=${leaseToken}, "leasedUntil"=now()+interval '2 minutes', attempts=attempts+1
      FROM picked WHERE o.id=picked.id RETURNING o.*
    ) SELECT c.*, s.endpoint,s.p256dh,s.auth FROM claimed c JOIN kublai_chat_push_subscription s ON s.id=c."subscriptionId"
  `);
  // The batch is bounded, and each provider request has both socket and absolute deadlines.
  await Promise.allSettled(
    deliveries.map((delivery) => deliver(delivery, configuration)),
  );
  await db.execute(
    sql`DELETE FROM kublai_conversation_push_outbox WHERE "completedAt"<now()-interval '7 days'`,
  );
}

const processState = globalThis as typeof globalThis & {
  conversationPushDrainTimer?: NodeJS.Timeout;
  conversationPushDraining?: boolean;
};
export function startConversationPushWorker() {
  if (processState.conversationPushDrainTimer || !getPushConfiguration())
    return;
  const tick = async () => {
    if (processState.conversationPushDraining) return;
    processState.conversationPushDraining = true;
    try {
      await drainConversationPush();
    } catch {
      console.warn(
        "Private chat notification delivery paused; pending deliveries will retry.",
      );
    } finally {
      processState.conversationPushDraining = false;
    }
  };
  processState.conversationPushDrainTimer = setInterval(
    () => void tick(),
    15000,
  );
  processState.conversationPushDrainTimer.unref();
  void tick();
}
