ALTER TABLE "kublai_job_drawing_set" ADD COLUMN IF NOT EXISTS "documentVersionId" uuid;
ALTER TABLE "kublai_job_drawing_sheet" ADD COLUMN IF NOT EXISTS "documentVersionId" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "drawing_document_version_set_idx" ON "kublai_job_drawing_set" ("documentVersionId") WHERE "documentVersionId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "drawing_document_version_page_idx" ON "kublai_job_drawing_sheet" ("documentVersionId", "sortOrder") WHERE "documentVersionId" IS NOT NULL;
