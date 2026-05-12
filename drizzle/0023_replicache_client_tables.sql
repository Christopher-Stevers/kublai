CREATE TABLE IF NOT EXISTS "kublai_replicache_client_group" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action,
  "userId" varchar(255) REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action,
  "schemaVersion" varchar(80) NOT NULL,
  "cvrVersion" integer DEFAULT 0 NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "replicache_client_group_org_idx"
  ON "kublai_replicache_client_group" USING btree ("organizationId");

CREATE TABLE IF NOT EXISTS "kublai_replicache_client" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "clientGroupId" varchar(255) NOT NULL REFERENCES "public"."kublai_replicache_client_group"("id") ON DELETE cascade ON UPDATE no action,
  "organizationId" uuid NOT NULL REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action,
  "userId" varchar(255) REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action,
  "lastMutationId" integer DEFAULT 0 NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "replicache_client_group_idx"
  ON "kublai_replicache_client" USING btree ("clientGroupId");

CREATE INDEX IF NOT EXISTS "replicache_client_org_idx"
  ON "kublai_replicache_client" USING btree ("organizationId");
