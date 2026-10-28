CREATE TABLE "kublai_hyperlink_reader_run" (
  "id" uuid PRIMARY KEY,
  "organizationId" uuid NOT NULL,
  "jobId" uuid NOT NULL,
  "sourceSheetId" uuid NOT NULL,
  "userId" text NOT NULL,
  "reader" text NOT NULL CHECK ("reader" IN ('terra', 'deepseek')),
  "fingerprint" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('reserved', 'done', 'failed')),
  "result" jsonb,
  "error" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "hyperlink_reader_budget_idx" ON "kublai_hyperlink_reader_run" ("organizationId", "createdAt");
CREATE INDEX "hyperlink_reader_cache_idx" ON "kublai_hyperlink_reader_run" ("organizationId", "sourceSheetId", "reader", "fingerprint");
