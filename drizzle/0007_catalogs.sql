CREATE TABLE "kublai_catalog" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kublai_catalog" ADD CONSTRAINT "kublai_catalog_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD COLUMN "catalogId" uuid;
--> statement-breakpoint
UPDATE "kublai_catalog" c
SET "sortOrder" = src.rn - 1
FROM (
	SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id") AS rn
	FROM "kublai_catalog"
) AS src
WHERE c."id" = src."id";
--> statement-breakpoint
INSERT INTO "kublai_catalog" ("id", "organizationId", "name", "sortOrder", "createdAt")
SELECT gen_random_uuid(), o."id", 'Default Catalog', 0, NOW()
FROM "kublai_organization" o
WHERE NOT EXISTS (
	SELECT 1 FROM "kublai_catalog" c WHERE c."organizationId" = o."id"
);
--> statement-breakpoint
UPDATE "kublai_part_definition" pd
SET "catalogId" = c."id"
FROM "kublai_catalog" c
WHERE c."organizationId" = pd."organizationId"
AND c."name" = 'Default Catalog'
AND pd."catalogId" IS NULL;
--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ALTER COLUMN "catalogId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_catalogId_kublai_catalog_id_fk" FOREIGN KEY ("catalogId") REFERENCES "public"."kublai_catalog"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_org_name_uniq" ON "kublai_catalog" USING btree ("organizationId","name");
--> statement-breakpoint
CREATE INDEX "catalog_org_idx" ON "kublai_catalog" USING btree ("organizationId");
--> statement-breakpoint
CREATE INDEX "part_def_catalog_idx" ON "kublai_part_definition" USING btree ("catalogId");