CREATE TABLE "kublai_drawing_legend_item" (
  "id" uuid PRIMARY KEY,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "setId" uuid NOT NULL REFERENCES "kublai_job_drawing_set"("id") ON DELETE CASCADE,
  "sourceSheetId" uuid NOT NULL REFERENCES "kublai_job_drawing_sheet"("id") ON DELETE CASCADE,
  "sourceKey" varchar(100) NOT NULL,
  "data" jsonb NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "reviewedBy" varchar(255) NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "drawing_legend_source_idx" ON "kublai_drawing_legend_item" ("setId", "sourceSheetId", "sourceKey");
CREATE INDEX "drawing_legend_set_idx" ON "kublai_drawing_legend_item" ("organizationId", "setId");
