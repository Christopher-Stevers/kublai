CREATE TABLE IF NOT EXISTS "kublai_job_chat_member" (
 "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
 "userId" varchar(255) NOT NULL REFERENCES "kublai_user"("id") ON DELETE CASCADE,
 "muted" boolean NOT NULL DEFAULT false,
 "lastReadSequence" bigint NOT NULL DEFAULT 0 CHECK ("lastReadSequence" >= 0),
 "joinedAt" timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY ("jobId", "userId")
);
CREATE INDEX IF NOT EXISTS "job_chat_member_user_idx" ON "kublai_job_chat_member" ("userId");
CREATE TABLE IF NOT EXISTS "kublai_job_chat_message" (
 "id" uuid PRIMARY KEY,
 "sequence" bigserial NOT NULL UNIQUE,
 "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
 "authorId" varchar(255) REFERENCES "kublai_user"("id") ON DELETE SET NULL,
 "clientId" uuid NOT NULL,
 "requestHash" varchar(64) NOT NULL,
 "body" text NOT NULL CHECK (length("body") <= 8000),
 "replyToId" uuid REFERENCES "kublai_job_chat_message"("id") ON DELETE SET NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "editedAt" timestamptz,
 "deletedAt" timestamptz,
 CONSTRAINT "job_chat_message_retry_uniq" UNIQUE ("jobId", "authorId", "clientId")
);
CREATE INDEX IF NOT EXISTS "job_chat_message_page_idx" ON "kublai_job_chat_message" ("jobId", "sequence");
CREATE INDEX IF NOT EXISTS "job_chat_message_author_time_idx" ON "kublai_job_chat_message" ("authorId", "createdAt");
CREATE TABLE IF NOT EXISTS "kublai_job_chat_event" (
 "sequence" bigserial PRIMARY KEY,
 "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
 "messageId" uuid NOT NULL REFERENCES "kublai_job_chat_message"("id") ON DELETE CASCADE,
 "type" varchar(16) NOT NULL CHECK ("type" IN ('created', 'edited', 'deleted')),
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "job_chat_event_page_idx" ON "kublai_job_chat_event" ("jobId", "sequence");
CREATE TABLE IF NOT EXISTS "kublai_job_chat_attachment" (
 "id" uuid PRIMARY KEY,
 "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
 "uploadedById" varchar(255) REFERENCES "kublai_user"("id") ON DELETE SET NULL,
 "messageId" uuid REFERENCES "kublai_job_chat_message"("id") ON DELETE CASCADE,
 "name" varchar(255) NOT NULL,
 "mimeType" varchar(80) NOT NULL CHECK ("mimeType" IN ('image/jpeg','image/png','image/webp','image/gif','application/pdf')),
 "size" integer NOT NULL CHECK ("size" > 0 AND "size" <= 10485760),
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "job_chat_attachment_message_idx" ON "kublai_job_chat_attachment" ("messageId");
CREATE INDEX IF NOT EXISTS "job_chat_attachment_pending_idx" ON "kublai_job_chat_attachment" ("uploadedById", "createdAt");
