ALTER TABLE "kublai_user"
  ADD COLUMN IF NOT EXISTS "organizationAccessStatus" varchar(50) DEFAULT 'approved';

UPDATE "kublai_user"
SET "organizationAccessStatus" = 'approved'
WHERE "organizationId" IS NOT NULL
  AND ("organizationAccessStatus" IS NULL OR "organizationAccessStatus" = '');
