ALTER TABLE kublai_order ADD COLUMN IF NOT EXISTS "previousOrderNumbers" jsonb NOT NULL DEFAULT '[]'::jsonb;
