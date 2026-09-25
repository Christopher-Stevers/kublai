-- Asset Management (tools & equipment). Additive only: new columns default to
-- today's behaviour ("materials" / "external"), and every table is new.

ALTER TABLE "kublai_catalog" ADD COLUMN IF NOT EXISTS "kind" varchar(20) DEFAULT 'materials' NOT NULL;
ALTER TABLE "kublai_supplier" ADD COLUMN IF NOT EXISTS "kind" varchar(20) DEFAULT 'external' NOT NULL;
ALTER TABLE "kublai_part_definition" ADD COLUMN IF NOT EXISTS "assetTracking" varchar(20);
ALTER TABLE "kublai_material_list" ADD COLUMN IF NOT EXISTS "kind" varchar(20) DEFAULT 'materials' NOT NULL;
ALTER TABLE "kublai_order" ADD COLUMN IF NOT EXISTS "kind" varchar(20) DEFAULT 'materials' NOT NULL;
ALTER TABLE "kublai_order" ADD COLUMN IF NOT EXISTS "fulfillmentStatus" varchar(20);
ALTER TABLE "kublai_order" ADD COLUMN IF NOT EXISTS "fulfilledAt" timestamp with time zone;
ALTER TABLE "kublai_order_item" ADD COLUMN IF NOT EXISTS "assetId" uuid;
ALTER TABLE "kublai_order_item" ADD COLUMN IF NOT EXISTS "fulfilledQuantity" numeric(12, 6);

CREATE TABLE IF NOT EXISTS "kublai_asset_location" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "kind" varchar(20) NOT NULL,
  "name" varchar(255) NOT NULL,
  "notes" text,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "asset_location_org_idx" ON "kublai_asset_location" ("organizationId");

CREATE TABLE IF NOT EXISTS "kublai_asset" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "partDefinitionId" uuid NOT NULL REFERENCES "kublai_part_definition"("id") ON DELETE RESTRICT,
  "assetTag" varchar(40) NOT NULL,
  "serialNumber" varchar(120),
  "status" varchar(20) DEFAULT 'available' NOT NULL,
  "holderType" varchar(20) NOT NULL,
  "holderId" varchar(255) NOT NULL,
  "notes" text,
  "createdAt" timestamp with time zone NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "asset_org_tag_uniq" UNIQUE ("organizationId", "assetTag")
);
CREATE INDEX IF NOT EXISTS "asset_org_holder_idx" ON "kublai_asset" ("organizationId", "holderType", "holderId");
CREATE INDEX IF NOT EXISTS "asset_part_idx" ON "kublai_asset" ("partDefinitionId");

CREATE TABLE IF NOT EXISTS "kublai_asset_stock" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "partDefinitionId" uuid NOT NULL REFERENCES "kublai_part_definition"("id") ON DELETE RESTRICT,
  "holderType" varchar(20) NOT NULL,
  "holderId" varchar(255) NOT NULL,
  "quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "asset_stock_holding_uniq" UNIQUE ("organizationId", "partDefinitionId", "holderType", "holderId")
);
CREATE INDEX IF NOT EXISTS "asset_stock_holder_idx" ON "kublai_asset_stock" ("organizationId", "holderType", "holderId");

CREATE TABLE IF NOT EXISTS "kublai_asset_movement" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "kind" varchar(20) NOT NULL,
  "assetId" uuid REFERENCES "kublai_asset"("id") ON DELETE CASCADE,
  "partDefinitionId" uuid NOT NULL REFERENCES "kublai_part_definition"("id") ON DELETE RESTRICT,
  "quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
  "fromType" varchar(20),
  "fromId" varchar(255),
  "toType" varchar(20),
  "toId" varchar(255),
  "statusFrom" varchar(20),
  "statusTo" varchar(20),
  "orderId" uuid REFERENCES "kublai_order"("id") ON DELETE SET NULL,
  "countId" uuid,
  "note" text,
  "userId" varchar(255) REFERENCES "kublai_user"("id") ON DELETE SET NULL,
  "createdAt" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "asset_movement_org_created_idx" ON "kublai_asset_movement" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "asset_movement_asset_idx" ON "kublai_asset_movement" ("assetId");

CREATE TABLE IF NOT EXISTS "kublai_asset_count" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "holderType" varchar(20) NOT NULL,
  "holderId" varchar(255) NOT NULL,
  "status" varchar(20) DEFAULT 'open' NOT NULL,
  "notes" text,
  "startedByUserId" varchar(255) REFERENCES "kublai_user"("id") ON DELETE SET NULL,
  "completedByUserId" varchar(255) REFERENCES "kublai_user"("id") ON DELETE SET NULL,
  "createdAt" timestamp with time zone NOT NULL,
  "completedAt" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "asset_count_org_idx" ON "kublai_asset_count" ("organizationId", "status");

CREATE TABLE IF NOT EXISTS "kublai_asset_count_line" (
  "id" uuid PRIMARY KEY NOT NULL,
  "countId" uuid NOT NULL REFERENCES "kublai_asset_count"("id") ON DELETE CASCADE,
  "assetId" uuid REFERENCES "kublai_asset"("id") ON DELETE CASCADE,
  "partDefinitionId" uuid NOT NULL REFERENCES "kublai_part_definition"("id") ON DELETE RESTRICT,
  "expectedQuantity" numeric(12, 3) DEFAULT '0' NOT NULL,
  "countedQuantity" numeric(12, 3),
  CONSTRAINT "asset_count_line_asset_uniq" UNIQUE ("countId", "assetId")
);
CREATE INDEX IF NOT EXISTS "asset_count_line_count_idx" ON "kublai_asset_count_line" ("countId");
