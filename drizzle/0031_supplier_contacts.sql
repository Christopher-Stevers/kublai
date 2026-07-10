ALTER TABLE "kublai_supplier"
  ADD COLUMN IF NOT EXISTS "contacts" jsonb;

UPDATE "kublai_supplier"
SET "contacts" = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'name', NULLIF(BTRIM(COALESCE("contactName", '')), ''),
    'email', NULLIF(BTRIM(COALESCE("contactEmail", '')), ''),
    'phone', NULLIF(BTRIM(COALESCE("contactPhone", '')), ''),
    'emailRole', 'to'
  )
)
WHERE "contacts" IS NULL
  AND (
    NULLIF(BTRIM(COALESCE("contactName", '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE("contactEmail", '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE("contactPhone", '')), '') IS NOT NULL
  );
