CREATE TABLE IF NOT EXISTS "kublai_organization_invite" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL,
  "token" varchar(128) NOT NULL,
  "role" varchar(50) DEFAULT 'user' NOT NULL,
  "createdByUserId" varchar(255),
  "expiresAt" timestamp with time zone NOT NULL,
  "revokedAt" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "kublai_organization_invite" ADD CONSTRAINT "kublai_organization_invite_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "kublai_organization_invite" ADD CONSTRAINT "kublai_organization_invite_createdByUserId_kublai_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "organization_invite_token_uniq" ON "kublai_organization_invite" USING btree ("token");
CREATE INDEX IF NOT EXISTS "organization_invite_org_idx" ON "kublai_organization_invite" USING btree ("organizationId");
