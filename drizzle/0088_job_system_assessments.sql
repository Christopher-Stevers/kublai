CREATE TABLE "kublai_job_system_assessment" (
  "id" uuid PRIMARY KEY,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
  "requestedBy" varchar(255) NOT NULL,
  "status" varchar(20) NOT NULL CHECK ("status" IN ('processing', 'ready', 'failed')),
  "data" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "job_system_assessment_job_idx" ON "kublai_job_system_assessment" ("jobId");
CREATE INDEX "job_system_assessment_org_idx" ON "kublai_job_system_assessment" ("organizationId", "jobId");
