ALTER TABLE "kublai_user" ADD COLUMN IF NOT EXISTS "defaultLandingPage" jsonb;
ALTER TABLE "kublai_organization_invite" ADD COLUMN IF NOT EXISTS "defaultLandingPage" jsonb;
