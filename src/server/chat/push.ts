import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Agent } from "node:https";
import { sql } from "drizzle-orm";
import webpush from "web-push";
import { env } from "~/env";
import { db } from "~/server/db";
import { chatPushOutbox } from "~/server/db/chat-push-schema";
import type { ChatTransaction } from "./types";
import {
  chatPushPayload,
  eligibleForChatPush,
  isAllowedPushEndpoint,
  isPublicPushAddress,
  MAX_PUSH_ATTEMPTS,
  PUSH_TTL_SECONDS,
  pushFailure,
  type PushRecipient,
} from "./push-policy";

export function getPushConfiguration() {
  const {
    WEB_PUSH_PUBLIC_KEY: publicKey,
    WEB_PUSH_PRIVATE_KEY: privateKey,
    WEB_PUSH_SUBJECT: subject,
  } = env;
  if (!publicKey || !privateKey || !subject) return null;
  try {
    // Validate all three, including key format, without sending a notification.
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { publicKey, privateKey, subject };
  } catch {
    return null;
  }
}

type Candidate = {
  subscriptionId: string;
  subscriptionUserId: string;
  user: PushRecipient;
  createdById: string | null;
  foremanId: string | null;
  member: { muted: boolean; lastReadSequence: number } | null;
};
export async function enqueueChatPush(
  tx: ChatTransaction,
  message: {
    organizationId: string;
    jobId: string;
    messageId: string;
    senderId: string;
    sequence: number;
  },
) {
  const candidates = await tx.execute<Candidate>(sql`
    SELECT s.id AS "subscriptionId", s."userId" AS "subscriptionUserId", to_jsonb(u) AS "user",
      j."createdByUserId" AS "createdById", j."foremanUserId" AS "foremanId",
      CASE WHEN m."userId" IS NULL THEN NULL ELSE jsonb_build_object('muted', m.muted, 'lastReadSequence', m."lastReadSequence") END AS member
    FROM kublai_chat_push_subscription s JOIN kublai_user u ON u.id=s."userId"
    JOIN kublai_job j ON j.id=${message.jobId} AND j."organizationId"=u."organizationId"
    LEFT JOIN kublai_job_chat_member m ON m."jobId"=j.id AND m."userId"=u.id
    WHERE u."organizationId"=${message.organizationId} AND u.id<>${message.senderId}
      AND (m."userId" IS NOT NULL OR j."createdByUserId"=u.id OR j."foremanUserId"=u.id OR u."currentJobId"=j.id)
  `);
  const values = candidates
    .filter((candidate) => eligibleForChatPush({ ...message, ...candidate }))
    .map((candidate) => ({
      ...message,
      subscriptionId: candidate.subscriptionId,
      recipientId: candidate.user.id,
    }));
  if (values.length)
    await tx.insert(chatPushOutbox).values(values).onConflictDoNothing();
}

type Delivery = {
  id: string;
  leaseToken: string;
  attempts: number;
  jobId: string;
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
) {
  if (!isAllowedPushEndpoint(delivery.endpoint))
    throw Object.assign(new Error("Invalid push provider"), {
      statusCode: 400,
    });
  const hostname = new URL(delivery.endpoint).hostname;
  let lookupTimer: NodeJS.Timeout | undefined;
  const addresses = await Promise.race([
    lookup(hostname, { all: true }),
    new Promise<never>((_, reject) => {
      lookupTimer = setTimeout(
        () => reject(new Error("Push DNS timeout")),
        3000,
      );
    }),
  ]).finally(() => clearTimeout(lookupTimer));
  if (
    !addresses.length ||
    addresses.some((address) => !isPublicPushAddress(address.address))
  ) {
    throw Object.assign(new Error("Invalid push provider address"), {
      statusCode: 400,
    });
  }
  // Pin the validated DNS answer. Do not resolve again between validation and HTTPS.
  const address = addresses[0]!;
  const agent = new Agent({
    lookup: (_host, options, callback) => {
      if (options.all) callback(null, addresses);
      else callback(null, address.address, address.family);
    },
  });
  const deadline = setTimeout(() => agent.destroy(), 12000);
  try {
    await webpush.sendNotification(
      {
        endpoint: delivery.endpoint,
        keys: { p256dh: delivery.p256dh, auth: delivery.auth },
      },
      chatPushPayload(delivery.jobId, delivery.recipientId),
      {
        vapidDetails: configuration,
        TTL: PUSH_TTL_SECONDS,
        timeout: 8000,
        urgency: "normal",
        agent,
      },
    );
  } finally {
    clearTimeout(deadline);
    agent.destroy();
  }
}

async function settle(delivery: Delivery, outcome: string, retryMs?: number) {
  await db.execute(sql`UPDATE kublai_chat_push_outbox SET
    "completedAt"=${retryMs === undefined ? sql`now()` : sql`NULL`}, outcome=${outcome},
    "availableAt"=now()+(${retryMs ?? 0} * interval '1 millisecond'), "leasedUntil"=NULL, "leaseToken"=NULL
    WHERE id=${delivery.id} AND "leaseToken"=${delivery.leaseToken}`);
}

async function deliver(
  delivery: Delivery,
  configuration: NonNullable<ReturnType<typeof getPushConfiguration>>,
) {
  // Read access, subscription ownership, read position, mute and deleted message again at delivery time.
  const [current] = await db.execute<Candidate>(sql`
    SELECT s."userId" AS "subscriptionUserId", to_jsonb(u) AS "user", j."createdByUserId" AS "createdById", j."foremanUserId" AS "foremanId",
      CASE WHEN m."userId" IS NULL THEN NULL ELSE jsonb_build_object('muted',m.muted,'lastReadSequence',m."lastReadSequence") END AS member
    FROM kublai_chat_push_outbox o JOIN kublai_chat_push_subscription s ON s.id=o."subscriptionId"
    JOIN kublai_user u ON u.id=o."recipientId" JOIN kublai_job j ON j.id=o."jobId" AND j."organizationId"=o."organizationId"
    JOIN kublai_job_chat_message msg ON msg.id=o."messageId" AND msg."jobId"=j.id AND msg."deletedAt" IS NULL
    LEFT JOIN kublai_job_chat_member m ON m."jobId"=j.id AND m."userId"=u.id
    WHERE o.id=${delivery.id} AND o."leaseToken"=${delivery.leaseToken} AND o."leasedUntil">now()
      AND s."userId"=o."recipientId" AND s.endpoint=${delivery.endpoint} AND s.p256dh=${delivery.p256dh} AND s.auth=${delivery.auth}
  `);
  if (!current || !eligibleForChatPush({ ...delivery, ...current })) {
    await settle(delivery, "skipped");
    return;
  }
  try {
    await sendToProvider(delivery, configuration);
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
export async function drainChatPush() {
  const configuration = getPushConfiguration();
  if (!configuration) return;
  await db.execute(sql`UPDATE kublai_chat_push_outbox SET "completedAt"=now(), outcome='expired', "leaseToken"=NULL, "leasedUntil"=NULL
    WHERE "completedAt" IS NULL AND ("createdAt"<now()-interval '1 day' OR attempts>=${MAX_PUSH_ATTEMPTS})
      AND ("leasedUntil" IS NULL OR "leasedUntil"<now())`);
  const leaseToken = randomUUID();
  const deliveries = await db.execute<Delivery>(sql`
    WITH picked AS (
      SELECT id FROM kublai_chat_push_outbox WHERE "completedAt" IS NULL AND "availableAt"<=now()
        AND ("leasedUntil" IS NULL OR "leasedUntil"<now()) AND attempts<${MAX_PUSH_ATTEMPTS}
      ORDER BY "availableAt",id LIMIT 8 FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE kublai_chat_push_outbox o SET "leaseToken"=${leaseToken}, "leasedUntil"=now()+interval '2 minutes', attempts=attempts+1
      FROM picked WHERE o.id=picked.id RETURNING o.*
    ) SELECT c.*, s.endpoint,s.p256dh,s.auth FROM claimed c JOIN kublai_chat_push_subscription s ON s.id=c."subscriptionId"
  `);
  // The batch is bounded, and each provider request has both socket and absolute deadlines.
  await Promise.allSettled(
    deliveries.map((delivery) => deliver(delivery, configuration)),
  );
  await db.execute(
    sql`DELETE FROM kublai_chat_push_outbox WHERE "completedAt"<now()-interval '7 days'`,
  );
}

const processState = globalThis as typeof globalThis & {
  chatPushDrainTimer?: NodeJS.Timeout;
  chatPushDraining?: boolean;
};
export function startChatPushWorker() {
  if (processState.chatPushDrainTimer || !getPushConfiguration()) return;
  const tick = async () => {
    if (processState.chatPushDraining) return;
    processState.chatPushDraining = true;
    try {
      await drainChatPush();
    } catch {
      console.warn(
        "Chat notification delivery paused; pending deliveries will retry.",
      );
    } finally {
      processState.chatPushDraining = false;
    }
  };
  processState.chatPushDrainTimer = setInterval(() => void tick(), 15000);
  processState.chatPushDrainTimer.unref();
  void tick();
}
