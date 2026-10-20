CREATE TABLE "kublai_pipe_system_spec" (
  "id" uuid PRIMARY KEY,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "jobId" uuid REFERENCES "kublai_job"("id") ON DELETE CASCADE,
  "system" varchar(40) NOT NULL,
  "data" jsonb NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "updatedBy" varchar(255) NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "pipe_system_spec_company_idx" ON "kublai_pipe_system_spec" ("organizationId", "system") WHERE "jobId" IS NULL;
CREATE UNIQUE INDEX "pipe_system_spec_job_idx" ON "kublai_pipe_system_spec" ("jobId", "system") WHERE "jobId" IS NOT NULL;
CREATE INDEX "pipe_system_spec_org_idx" ON "kublai_pipe_system_spec" ("organizationId");
