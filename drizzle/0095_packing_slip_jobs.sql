CREATE TABLE "kublai_packing_slip_job" (
  "id" uuid PRIMARY KEY,
  "organizationId" uuid NOT NULL,
  "jobId" uuid NOT NULL,
  "documentId" uuid NOT NULL,
  "orderId" uuid NOT NULL,
  "versionId" uuid NOT NULL,
  "userId" varchar(255) NOT NULL,
  "status" text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued','running','done','failed')),
  "workerId" uuid,
  "leaseUntil" timestamptz,
  "attempts" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "packing_slip_job_queue_idx" ON "kublai_packing_slip_job" ("status", "createdAt");
