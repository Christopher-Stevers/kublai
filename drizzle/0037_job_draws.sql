-- Additive: new tables for job draws (progress billing). No existing data changes.
CREATE TABLE IF NOT EXISTS "kublai_job_draw_line" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
  "itemNumber" varchar(50),
  "description" varchar(500) NOT NULL,
  "scheduledValue" numeric(14, 2) DEFAULT '0' NOT NULL,
  "sortOrder" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "job_draw_line_job_idx"
  ON "kublai_job_draw_line" ("jobId", "sortOrder");

CREATE TABLE IF NOT EXISTS "kublai_job_draw" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
  "drawNumber" integer NOT NULL,
  "periodEnd" date,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "retainagePercent" numeric(6, 3) DEFAULT '10' NOT NULL,
  "notes" text,
  "submittedAt" timestamp with time zone,
  "paidAt" timestamp with time zone,
  "createdByUserId" varchar(255) REFERENCES "kublai_user"("id") ON DELETE SET NULL,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "job_draw_job_number_uniq" UNIQUE ("jobId", "drawNumber")
);

CREATE INDEX IF NOT EXISTS "job_draw_org_idx"
  ON "kublai_job_draw" ("organizationId");

CREATE TABLE IF NOT EXISTS "kublai_job_draw_item" (
  "drawId" uuid NOT NULL REFERENCES "kublai_job_draw"("id") ON DELETE CASCADE,
  "lineId" uuid NOT NULL REFERENCES "kublai_job_draw_line"("id") ON DELETE CASCADE,
  "completedToDate" numeric(14, 2) DEFAULT '0' NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  PRIMARY KEY ("drawId", "lineId")
);

CREATE INDEX IF NOT EXISTS "job_draw_item_line_idx"
  ON "kublai_job_draw_item" ("lineId");
