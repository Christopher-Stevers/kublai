CREATE TABLE IF NOT EXISTS "kublai_conversation_push_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "conversationId" uuid NOT NULL REFERENCES "kublai_conversation"("id") ON DELETE CASCADE,
  "messageId" uuid NOT NULL REFERENCES "kublai_conversation_message"("id") ON DELETE CASCADE,
  "subscriptionId" uuid NOT NULL REFERENCES "kublai_chat_push_subscription"("id") ON DELETE CASCADE,
  "recipientId" varchar(255) NOT NULL REFERENCES "kublai_user"("id") ON DELETE CASCADE,
  "senderId" varchar(255) NOT NULL,
  "sequence" bigint NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "availableAt" timestamptz NOT NULL DEFAULT now(),
  "leaseToken" uuid,
  "leasedUntil" timestamptz,
  "completedAt" timestamptz,
  "outcome" varchar(32),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_push_message_device_uniq" ON "kublai_conversation_push_outbox"("messageId", "subscriptionId");
CREATE INDEX IF NOT EXISTS "conversation_push_ready_idx" ON "kublai_conversation_push_outbox"("completedAt", "availableAt", "leasedUntil");
