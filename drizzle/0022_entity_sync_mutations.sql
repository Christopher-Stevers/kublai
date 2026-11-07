CREATE TABLE IF NOT EXISTS "kublai_entity_sync_mutation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "user_id" varchar(255),
  "client_mutation_id" varchar(255) NOT NULL,
  "mutation_type" varchar(80) NOT NULL,
  "entity_type" varchar(80) NOT NULL,
  "client_entity_id" varchar(255) NOT NULL,
  "server_entity_id" uuid,
  "status" varchar(40) DEFAULT 'applied' NOT NULL,
  "error" text,
  "payload" jsonb,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "kublai_entity_sync_mutation_organization_id_kublai_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "kublai_entity_sync_mutation_user_id_kublai_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "entity_sync_mutation_client_uniq"
  ON "kublai_entity_sync_mutation" USING btree ("organization_id", "client_mutation_id");

CREATE INDEX IF NOT EXISTS "entity_sync_mutation_entity_idx"
  ON "kublai_entity_sync_mutation" USING btree ("organization_id", "entity_type", "server_entity_id");
