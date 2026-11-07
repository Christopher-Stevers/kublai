ALTER TABLE "kublai_job"
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "kublai_supplier"
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;

CREATE INDEX IF NOT EXISTS "job_org_updated_idx"
  ON "kublai_job" USING btree ("organizationId", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "supplier_org_updated_idx"
  ON "kublai_supplier" USING btree ("organizationId", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "material_list_org_updated_idx"
  ON "kublai_material_list" USING btree ("organizationId", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "quote_item_updated_idx"
  ON "kublai_quote_item" USING btree ("updatedAt", "id");

CREATE INDEX IF NOT EXISTS "material_list_sync_tombstone_org_deleted_idx"
  ON "kublai_material_list_sync_tombstone" USING btree ("organizationId", "deletedAt", "entityId");

CREATE UNIQUE INDEX IF NOT EXISTS "order_org_job_number_uniq"
  ON "kublai_order" USING btree ("organizationId", "jobId", "orderNumber")
  WHERE "orderNumber" IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "part_definition_display_name_trgm_idx"
  ON "kublai_part_definition" USING gin ("displayName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "part_definition_description_trgm_idx"
  ON "kublai_part_definition" USING gin ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "part_synonym_synonym_trgm_idx"
  ON "kublai_part_synonym" USING gin ("synonym" gin_trgm_ops);
