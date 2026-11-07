CREATE TABLE IF NOT EXISTS "kublai_conversation" (
 "id" uuid PRIMARY KEY,
 "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
 "kind" varchar(8) NOT NULL CHECK ("kind" IN ('direct','group')),
 "name" varchar(120) NOT NULL DEFAULT '',
 "directKey" varchar(64),
 "createdById" varchar(255) REFERENCES "kublai_user"("id") ON DELETE SET NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now(),
 CHECK (("kind"='direct' AND "directKey" IS NOT NULL) OR ("kind"='group' AND "directKey" IS NULL AND length(trim("name"))>0))
);
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_direct_key_unique" ON "kublai_conversation" ("organizationId","directKey");
CREATE INDEX IF NOT EXISTS "conversation_org_idx" ON "kublai_conversation" ("organizationId","updatedAt");
CREATE TABLE IF NOT EXISTS "kublai_conversation_member" (
 "conversationId" uuid NOT NULL REFERENCES "kublai_conversation"("id") ON DELETE CASCADE,
 "userId" varchar(255) NOT NULL REFERENCES "kublai_user"("id") ON DELETE CASCADE,
 "lastReadSequence" bigint NOT NULL DEFAULT 0 CHECK ("lastReadSequence">=0),
 "joinedAt" timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY ("conversationId","userId")
);
CREATE INDEX IF NOT EXISTS "conversation_member_user_idx" ON "kublai_conversation_member" ("userId");
CREATE TABLE IF NOT EXISTS "kublai_conversation_message" (
 "id" uuid PRIMARY KEY,
 "sequence" bigserial NOT NULL UNIQUE,
 "conversationId" uuid NOT NULL REFERENCES "kublai_conversation"("id") ON DELETE CASCADE,
 "authorId" varchar(255) REFERENCES "kublai_user"("id") ON DELETE SET NULL,
 "clientId" uuid NOT NULL,
 "requestHash" varchar(64) NOT NULL,
 "body" text NOT NULL CHECK (length("body")<=8000),
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "deletedAt" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_message_retry_unique" ON "kublai_conversation_message" ("conversationId","authorId","clientId");
CREATE INDEX IF NOT EXISTS "conversation_message_page_idx" ON "kublai_conversation_message" ("conversationId","sequence");
CREATE INDEX IF NOT EXISTS "conversation_message_author_time_idx" ON "kublai_conversation_message" ("authorId","createdAt");
CREATE TABLE IF NOT EXISTS "kublai_conversation_attachment" (
 "id" uuid PRIMARY KEY,
 "conversationId" uuid NOT NULL REFERENCES "kublai_conversation"("id") ON DELETE CASCADE,
 "uploadedById" varchar(255) REFERENCES "kublai_user"("id") ON DELETE SET NULL,
 "messageId" uuid REFERENCES "kublai_conversation_message"("id") ON DELETE CASCADE,
 "name" varchar(200) NOT NULL,
 "mimeType" varchar(80) NOT NULL CHECK ("mimeType" IN ('image/jpeg','image/png','image/webp','image/gif','application/pdf')),
 "size" integer NOT NULL CHECK ("size">0 AND "size"<=10485760),
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "conversation_attachment_message_idx" ON "kublai_conversation_attachment" ("messageId");
CREATE INDEX IF NOT EXISTS "conversation_attachment_uploader_idx" ON "kublai_conversation_attachment" ("uploadedById","createdAt");
