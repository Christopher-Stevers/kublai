CREATE TABLE IF NOT EXISTS "kublai_bim_design" (
 "modelId" uuid PRIMARY KEY REFERENCES "kublai_bim_model"("id") ON DELETE CASCADE,
 "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
 "jobId" uuid NOT NULL,
 "revision" integer NOT NULL,
 "data" jsonb NOT NULL,
 "updatedBy" varchar(255) NOT NULL,
 "updatedAt" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "bim_design_job_org_fk" FOREIGN KEY ("jobId", "organizationId") REFERENCES "kublai_job"("id", "organizationId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "bim_design_job_idx" ON "kublai_bim_design" ("organizationId", "jobId");
