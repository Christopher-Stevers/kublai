ALTER TABLE "kublai_user"
  ADD COLUMN IF NOT EXISTS "permissionConfig" jsonb;

ALTER TABLE "kublai_organization_invite"
  ADD COLUMN IF NOT EXISTS "name" varchar(255);

ALTER TABLE "kublai_organization_invite"
  ADD COLUMN IF NOT EXISTS "permissionConfig" jsonb;
