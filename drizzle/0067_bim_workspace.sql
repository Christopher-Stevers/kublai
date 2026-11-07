CREATE TABLE IF NOT EXISTS "kublai_bim_model" (
 "id" uuid PRIMARY KEY, "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
 "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE, "seriesId" uuid NOT NULL, "version" integer NOT NULL CHECK ("version">0),
 "data" jsonb NOT NULL, "sourceSha" varchar(64) NOT NULL, "viewSha" varchar(64), "conversionRequestedBy" varchar(255), "conversionCheckedAt" timestamp with time zone, "conversionUrn" text,
 "conversionLease" timestamp with time zone, "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
 CONSTRAINT "bim_model_job_org_fk" FOREIGN KEY ("jobId","organizationId") REFERENCES "kublai_job"("id","organizationId") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "bim_model_series_version_uniq" ON "kublai_bim_model" ("seriesId","version");
CREATE INDEX IF NOT EXISTS "bim_model_job_idx" ON "kublai_bim_model" ("organizationId","jobId");
CREATE TABLE IF NOT EXISTS "kublai_bim_view" (
 "id" uuid PRIMARY KEY, "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
 "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE, "data" jsonb NOT NULL,
 CONSTRAINT "bim_view_job_org_fk" FOREIGN KEY ("jobId","organizationId") REFERENCES "kublai_job"("id","organizationId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "bim_view_job_idx" ON "kublai_bim_view" ("organizationId","jobId");
CREATE TABLE IF NOT EXISTS "kublai_bim_issue" (
 "id" uuid PRIMARY KEY, "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
 "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE, "revision" integer NOT NULL CHECK ("revision">0), "data" jsonb NOT NULL,
 CONSTRAINT "bim_issue_job_org_fk" FOREIGN KEY ("jobId","organizationId") REFERENCES "kublai_job"("id","organizationId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "bim_issue_job_idx" ON "kublai_bim_issue" ("organizationId","jobId");
CREATE TABLE IF NOT EXISTS "kublai_bim_activity" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
 "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE, "actorId" varchar(255) NOT NULL,
 "action" varchar(100) NOT NULL, "entityId" uuid NOT NULL, "data" jsonb NOT NULL, "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
 CONSTRAINT "bim_activity_job_org_fk" FOREIGN KEY ("jobId","organizationId") REFERENCES "kublai_job"("id","organizationId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "bim_activity_job_idx" ON "kublai_bim_activity" ("organizationId","jobId","createdAt");
