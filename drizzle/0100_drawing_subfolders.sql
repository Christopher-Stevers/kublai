ALTER TABLE "kublai_job_drawing_set"
  ADD COLUMN IF NOT EXISTS "parentId" uuid REFERENCES "kublai_job_drawing_set" ("id");
CREATE INDEX IF NOT EXISTS "job_drawing_set_parent_idx" ON "kublai_job_drawing_set" ("parentId");
