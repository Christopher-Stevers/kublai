INSERT INTO "kublai_catalog" ("id", "organizationId", "name", "sortOrder", "createdAt")
SELECT gen_random_uuid(), c."organizationId", 'Plumbing', 0, NOW()
FROM "kublai_catalog" c
WHERE c."name" = 'Default Catalog'
  AND NOT EXISTS (
    SELECT 1
    FROM "kublai_catalog" existing
    WHERE existing."organizationId" = c."organizationId"
      AND existing."name" = 'Plumbing'
  )
GROUP BY c."organizationId";
--> statement-breakpoint
INSERT INTO "kublai_catalog" ("id", "organizationId", "name", "sortOrder", "createdAt")
SELECT gen_random_uuid(), o."id", 'Plumbing', 0, NOW()
FROM "kublai_organization" o
WHERE NOT EXISTS (
  SELECT 1
  FROM "kublai_catalog" c
  WHERE c."organizationId" = o."id"
    AND c."name" = 'Plumbing'
);
--> statement-breakpoint
UPDATE "kublai_part_definition" pd
SET "catalogId" = c."id"
FROM "kublai_catalog" c
WHERE c."organizationId" = pd."organizationId"
  AND c."name" = 'Plumbing'
  AND pd."catalogId" <> c."id";
--> statement-breakpoint
UPDATE "kublai_catalog" c
SET "sortOrder" = 0
WHERE c."name" = 'Plumbing';
