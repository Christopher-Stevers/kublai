CREATE TABLE IF NOT EXISTS "kublai_material_list_sync_tombstone" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE cascade,
  "material_list_id" uuid NOT NULL REFERENCES "kublai_material_list"("id") ON DELETE cascade,
  "entity_type" varchar(40) NOT NULL,
  "entity_id" varchar(255) NOT NULL,
  "deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "material_list_sync_tombstone_entity_uniq"
  ON "kublai_material_list_sync_tombstone" ("organization_id", "entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "material_list_sync_tombstone_list_idx"
  ON "kublai_material_list_sync_tombstone" ("material_list_id");

CREATE INDEX IF NOT EXISTS "material_list_sync_tombstone_deleted_idx"
  ON "kublai_material_list_sync_tombstone" ("deleted_at");
