CREATE TABLE IF NOT EXISTS kublai_packing_slip_review_history (
  id uuid PRIMARY KEY,
  "organizationId" uuid NOT NULL REFERENCES kublai_organization(id) ON DELETE CASCADE,
  "jobId" uuid NOT NULL,
  "documentId" uuid NOT NULL,
  "versionId" uuid NOT NULL,
  "runId" uuid NOT NULL,
  kind varchar(24) NOT NULL CHECK (kind IN ('analysis','failure','confirmation')),
  "userId" varchar(255) NOT NULL,
  release varchar(100) NOT NULL,
  data jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS packing_slip_history_run_kind_idx ON kublai_packing_slip_review_history ("organizationId", "runId", kind);
CREATE INDEX IF NOT EXISTS packing_slip_history_job_idx ON kublai_packing_slip_review_history ("organizationId", "jobId", "createdAt");
