CREATE TABLE "kublai_organization_department" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL CHECK (length(btrim("name")) > 0),
  "revision" integer NOT NULL DEFAULT 1,
  CONSTRAINT "organization_department_org_id_uniq" UNIQUE ("organizationId", "id")
);
CREATE UNIQUE INDEX "organization_department_name_uniq" ON "kublai_organization_department" ("organizationId", lower(btrim("name")));
CREATE TABLE "kublai_organization_department_lead" (
  "organizationId" uuid NOT NULL,
  "departmentId" uuid NOT NULL,
  "userId" varchar(255) NOT NULL,
  PRIMARY KEY ("departmentId", "userId"),
  FOREIGN KEY ("organizationId", "departmentId") REFERENCES "kublai_organization_department"("organizationId", "id") ON DELETE CASCADE,
  FOREIGN KEY ("organizationId", "userId") REFERENCES "kublai_user"("organizationId", "id") ON DELETE CASCADE
);
-- Preserve department names already used by members or live presets.
INSERT INTO "kublai_organization_department" ("organizationId", "name")
SELECT "organizationId", min(name) FROM (
  SELECT "organizationId", btrim("department") AS name FROM "kublai_user"
  UNION ALL
  SELECT "organizationId", btrim("memberDetails"->>'department') AS name FROM "kublai_organization_permission_preset"
) names WHERE "organizationId" IS NOT NULL AND name IS NOT NULL AND name <> ''
GROUP BY "organizationId", lower(name);
