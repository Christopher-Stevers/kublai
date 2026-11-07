ALTER TABLE kublai_job ADD COLUMN IF NOT EXISTS "supplierDefaults" jsonb;
ALTER TABLE kublai_quote_item ADD COLUMN IF NOT EXISTS "supplierVersion" jsonb;
