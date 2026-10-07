CREATE TABLE IF NOT EXISTS "kublai_drawing_workspace_entity" (
  "id" uuid PRIMARY KEY,
  "sheetId" uuid NOT NULL REFERENCES "kublai_job_drawing_sheet"("id") ON DELETE CASCADE,
  "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "entity" jsonb NOT NULL,
  "revision" integer NOT NULL CHECK ("revision" > 0),
  CONSTRAINT "drawing_entity_bounded" CHECK (octet_length(entity::text) <= 1048576),
  CONSTRAINT "drawing_entity_identity" CHECK (entity->>'id' = id::text AND entity->>'sheetId' = "sheetId"::text AND (entity->>'revision')::integer = revision)
);
CREATE INDEX IF NOT EXISTS "drawing_workspace_entity_sheet_idx" ON "kublai_drawing_workspace_entity" ("sheetId");
CREATE INDEX IF NOT EXISTS "drawing_workspace_entity_job_idx" ON "kublai_drawing_workspace_entity" ("organizationId", "jobId");
CREATE TABLE IF NOT EXISTS "kublai_drawing_workspace_metadata" (
  "sheetId" uuid PRIMARY KEY REFERENCES "kublai_job_drawing_sheet"("id") ON DELETE CASCADE,
  "data" jsonb NOT NULL,
  "revision" integer NOT NULL CHECK (revision > 0),
  CONSTRAINT "drawing_metadata_bounded" CHECK (octet_length(data::text) <= 32768)
);
CREATE TABLE IF NOT EXISTS "kublai_drawing_workspace_favorite" (
  "sheetId" uuid NOT NULL REFERENCES "kublai_job_drawing_sheet"("id") ON DELETE CASCADE,
  "userId" varchar(255) NOT NULL REFERENCES "kublai_user"("id") ON DELETE CASCADE,
  PRIMARY KEY ("sheetId", "userId")
);
CREATE TABLE IF NOT EXISTS "kublai_drawing_workspace_activity" (
  "id" uuid PRIMARY KEY,
  "sheetId" uuid NOT NULL REFERENCES "kublai_job_drawing_sheet"("id") ON DELETE CASCADE,
  "entry" jsonb NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "drawing_workspace_activity_sheet_idx" ON "kublai_drawing_workspace_activity" ("sheetId", "createdAt");
CREATE TABLE IF NOT EXISTS "kublai_drawing_workspace_watch" (
  "sheetId" uuid NOT NULL REFERENCES "kublai_job_drawing_sheet"("id") ON DELETE CASCADE,
  "userId" varchar(255) NOT NULL REFERENCES "kublai_user"("id") ON DELETE CASCADE,
  PRIMARY KEY ("sheetId", "userId")
);
CREATE TABLE IF NOT EXISTS "kublai_drawing_notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sheetId" uuid NOT NULL REFERENCES "kublai_job_drawing_sheet"("id") ON DELETE CASCADE,
  "entityId" uuid NOT NULL REFERENCES "kublai_drawing_workspace_entity"("id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  "senderId" varchar(255) NOT NULL,
  "recipientId" varchar(255) NOT NULL REFERENCES "kublai_user"("id") ON DELETE CASCADE,
  "reason" varchar(16) NOT NULL CHECK (reason IN ('watch', 'assignment', 'review')),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "readAt" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "drawing_notification_revision_recipient_uniq" ON "kublai_drawing_notification" ("entityId", "revision", "recipientId");
CREATE INDEX IF NOT EXISTS "drawing_notification_recipient_idx" ON "kublai_drawing_notification" ("recipientId", "createdAt");
CREATE TABLE IF NOT EXISTS "kublai_drawing_push_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notificationId" uuid NOT NULL REFERENCES "kublai_drawing_notification"("id") ON DELETE CASCADE,
  "subscriptionId" uuid NOT NULL REFERENCES "kublai_chat_push_subscription"("id") ON DELETE CASCADE,
  "attempts" integer NOT NULL DEFAULT 0,
  "availableAt" timestamp with time zone NOT NULL DEFAULT now(),
  "leaseToken" uuid,
  "leasedUntil" timestamp with time zone,
  "completedAt" timestamp with time zone,
  "outcome" varchar(32),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "drawing_push_notification_device_uniq" ON "kublai_drawing_push_outbox" ("notificationId", "subscriptionId");
CREATE INDEX IF NOT EXISTS "drawing_push_ready_idx" ON "kublai_drawing_push_outbox" ("completedAt", "availableAt", "leasedUntil");
