-- Additive and safe to apply before deploying the grouped material picker.
-- Existing material IDs and every part/list reference remain unchanged.
ALTER TABLE "kublai_material"
  ADD COLUMN IF NOT EXISTS "groupPath" jsonb NOT NULL DEFAULT '[]'::jsonb;
