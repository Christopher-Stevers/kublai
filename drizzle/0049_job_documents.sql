CREATE TABLE IF NOT EXISTS "kublai_job_document_workspace" (
  "jobId" uuid PRIMARY KEY REFERENCES "kublai_job"("id") ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "state" jsonb NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "job_document_workspace_state_version" CHECK (state->>'schemaVersion' = '1'),
  CONSTRAINT "job_document_workspace_bounded" CHECK (octet_length(state::text) <= 16777216)
);
CREATE INDEX IF NOT EXISTS "job_document_workspace_org_idx" ON "kublai_job_document_workspace" ("organizationId", "jobId");
