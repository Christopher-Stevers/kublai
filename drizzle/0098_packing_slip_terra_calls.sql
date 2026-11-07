CREATE TABLE "kublai_packing_slip_terra_call" (
  "id" uuid PRIMARY KEY,
  "organizationId" uuid NOT NULL,
  "jobId" uuid NOT NULL,
  "documentId" uuid NOT NULL,
  "versionId" uuid NOT NULL,
  "sourceHash" text NOT NULL,
  "requestHash" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('reserved','done','failed')),
  "budgetUsd" double precision NOT NULL CHECK ("budgetUsd" >= 0),
  "result" jsonb,
  "error" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "packing_slip_terra_budget_idx" ON "kublai_packing_slip_terra_call" ("createdAt");
