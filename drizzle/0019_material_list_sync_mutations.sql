CREATE TABLE IF NOT EXISTS "kublai_material_list_sync_mutation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE cascade,
  "user_id" varchar(255) REFERENCES "kublai_user"("id") ON DELETE set null,
  "material_list_id" uuid NOT NULL REFERENCES "kublai_material_list"("id") ON DELETE cascade,
  "client_mutation_id" varchar(255) NOT NULL,
  "mutation_type" varchar(80) NOT NULL,
  "server_item_id" uuid,
  "client_item_id" varchar(255),
  "status" varchar(40) DEFAULT 'applied' NOT NULL,
  "error" text,
  "payload" jsonb,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "material_list_sync_mutation_client_uniq"
  ON "kublai_material_list_sync_mutation" ("organization_id", "client_mutation_id");

CREATE INDEX IF NOT EXISTS "material_list_sync_mutation_list_idx"
  ON "kublai_material_list_sync_mutation" ("material_list_id");
