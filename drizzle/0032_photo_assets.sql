CREATE TABLE IF NOT EXISTS "kublai_photo_asset" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "storageKey" text NOT NULL,
  "url" text NOT NULL,
  "originalFilename" varchar(255),
  "contentType" varchar(100) DEFAULT 'image/webp' NOT NULL,
  "byteSize" integer,
  "checksum" varchar(64),
  "sourceUrl" text,
  "notes" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "photo_asset_org_url_uniq" UNIQUE("organizationId", "url")
);

CREATE INDEX IF NOT EXISTS "photo_asset_org_created_idx"
  ON "kublai_photo_asset" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "photo_asset_checksum_idx"
  ON "kublai_photo_asset" ("organizationId", "checksum");

ALTER TABLE "kublai_part_definition"
  ADD COLUMN IF NOT EXISTS "imageAssetId" uuid;

DO $$ BEGIN
  ALTER TABLE "kublai_part_definition"
    ADD CONSTRAINT "kublai_part_definition_imageAssetId_kublai_photo_asset_id_fk"
    FOREIGN KEY ("imageAssetId") REFERENCES "public"."kublai_photo_asset"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "part_def_image_asset_idx"
  ON "kublai_part_definition" ("imageAssetId");

INSERT INTO "kublai_photo_asset" (
  "organizationId",
  "storageKey",
  "url",
  "originalFilename",
  "contentType"
)
SELECT DISTINCT
  "organizationId",
  regexp_replace("imageUrl", '^/api/catalogue/images/', ''),
  "imageUrl",
  regexp_replace("imageUrl", '^.*/', ''),
  'image/webp'
FROM "kublai_part_definition"
WHERE "imageUrl" IS NOT NULL
  AND "imageUrl" <> ''
ON CONFLICT ("organizationId", "url") DO NOTHING;

UPDATE "kublai_part_definition" AS part
SET "imageAssetId" = asset."id"
FROM "kublai_photo_asset" AS asset
WHERE part."organizationId" = asset."organizationId"
  AND part."imageUrl" = asset."url"
  AND part."imageAssetId" IS NULL;
