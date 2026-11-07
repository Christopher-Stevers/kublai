ALTER TABLE "kublai_user" ADD COLUMN "department" varchar(100);
ALTER TABLE "kublai_user" ADD CONSTRAINT "user_organization_id_uniq" UNIQUE ("organizationId", "id");

CREATE TABLE "kublai_organization_reporting_line" (
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization" ("id") ON DELETE CASCADE,
  "userId" varchar(255) NOT NULL,
  "reportsToUserId" varchar(255) NOT NULL,
  PRIMARY KEY ("organizationId", "userId", "reportsToUserId"),
  FOREIGN KEY ("organizationId", "userId") REFERENCES "kublai_user" ("organizationId", "id") ON DELETE CASCADE,
  FOREIGN KEY ("organizationId", "reportsToUserId") REFERENCES "kublai_user" ("organizationId", "id") ON DELETE CASCADE,
  CONSTRAINT "organization_reporting_line_not_self" CHECK ("userId" <> "reportsToUserId")
);
CREATE INDEX "organization_reporting_line_manager_idx"
  ON "kublai_organization_reporting_line" ("organizationId", "reportsToUserId");

-- Departments and reporting lines belong to the organization being left.
CREATE FUNCTION kublai_clear_member_organization_details() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    DELETE FROM "kublai_organization_reporting_line"
      WHERE "userId" = OLD."id" OR "reportsToUserId" = OLD."id";
    NEW."department" := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER member_organization_details
  BEFORE UPDATE OF "organizationId" ON "kublai_user"
  FOR EACH ROW EXECUTE FUNCTION kublai_clear_member_organization_details();
