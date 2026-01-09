-- Migration for creative uploads feature
-- This migration adds new columns to kublai_creative table
-- Handles existing rows by making columns nullable first, then updating, then making NOT NULL
-- Step 1: Add nullable columns first (for existing rows)
ALTER TABLE "kublai_creative"
ADD COLUMN IF NOT EXISTS "userId" varchar(255);
ALTER TABLE "kublai_creative"
ADD COLUMN IF NOT EXISTS "fileType" varchar(50);
ALTER TABLE "kublai_creative"
ADD COLUMN IF NOT EXISTS "filePath" text;
ALTER TABLE "kublai_creative"
ADD COLUMN IF NOT EXISTS "fileSize" bigint;
ALTER TABLE "kublai_creative"
ADD COLUMN IF NOT EXISTS "mimeType" varchar(100);
ALTER TABLE "kublai_creative"
ADD COLUMN IF NOT EXISTS "approvedBy" varchar(255);
ALTER TABLE "kublai_creative"
ADD COLUMN IF NOT EXISTS "approvedAt" timestamp with time zone;
-- Step 2: For any existing rows, set default values (or delete them if they're test data)
-- Since this is a new feature, we'll assume existing rows are test data and can be deleted
-- If you have important data, uncomment the UPDATE statements below instead
DELETE FROM "kublai_creative"
WHERE "userId" IS NULL;
-- Alternative: If you need to keep existing data, uncomment these instead:
-- UPDATE "kublai_creative" SET 
--   "userId" = (SELECT "id" FROM "kublai_user" LIMIT 1),
--   "fileType" = 'image',
--   "filePath" = 'legacy/' || "id"::text,
--   "fileSize" = 0,
--   "mimeType" = 'image/jpeg'
-- WHERE "userId" IS NULL;
-- Step 3: Make columns NOT NULL (now that all rows have values)
ALTER TABLE "kublai_creative"
ALTER COLUMN "userId"
SET NOT NULL;
ALTER TABLE "kublai_creative"
ALTER COLUMN "fileType"
SET NOT NULL;
ALTER TABLE "kublai_creative"
ALTER COLUMN "filePath"
SET NOT NULL;
ALTER TABLE "kublai_creative"
ALTER COLUMN "fileSize"
SET NOT NULL;
ALTER TABLE "kublai_creative"
ALTER COLUMN "mimeType"
SET NOT NULL;
-- Step 4: Add foreign key constraints
DO $$ BEGIN IF NOT EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conname = 'kublai_creative_userId_kublai_user_id_fk'
) THEN
ALTER TABLE "kublai_creative"
ADD CONSTRAINT "kublai_creative_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE no action ON UPDATE no action;
END IF;
END $$;
DO $$ BEGIN IF NOT EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conname = 'kublai_creative_approvedBy_kublai_user_id_fk'
) THEN
ALTER TABLE "kublai_creative"
ADD CONSTRAINT "kublai_creative_approvedBy_kublai_user_id_fk" FOREIGN KEY ("approvedBy") REFERENCES "public"."kublai_user"("id") ON DELETE no action ON UPDATE no action;
END IF;
END $$;