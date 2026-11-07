CREATE TABLE "kublai_organization_permission_preset" (
  "id" uuid PRIMARY KEY,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization" ("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL CHECK (length(trim("name")) > 0),
  "permissionConfig" jsonb NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "organization_permission_preset_name_uniq"
  ON "kublai_organization_permission_preset" ("organizationId", lower(trim("name")));
CREATE INDEX "organization_permission_preset_org_idx"
  ON "kublai_organization_permission_preset" ("organizationId");
ALTER TABLE "kublai_user" ADD COLUMN "permissionPresetId" uuid
  REFERENCES "kublai_organization_permission_preset" ("id") ON DELETE RESTRICT;
CREATE INDEX "user_permission_preset_idx" ON "kublai_user" ("permissionPresetId");

-- All existing authorization paths read users.permissionConfig. Keep that
-- effective map current, including readers outside tRPC and older clients.
CREATE FUNCTION kublai_apply_member_permission_preset() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE preset_config jsonb;
BEGIN
  IF NEW."permissionPresetId" IS NOT NULL THEN
    SELECT "permissionConfig" INTO preset_config
      FROM "kublai_organization_permission_preset"
      WHERE "id" = NEW."permissionPresetId" AND "organizationId" = NEW."organizationId"
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Permission preset must belong to the member organization' USING ERRCODE = '23514';
    END IF;
    NEW."permissionConfig" := preset_config;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER member_permission_preset
  BEFORE INSERT OR UPDATE OF "permissionPresetId", "permissionConfig", "organizationId"
  ON "kublai_user" FOR EACH ROW EXECUTE FUNCTION kublai_apply_member_permission_preset();

CREATE FUNCTION kublai_propagate_permission_preset() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "kublai_user" SET "permissionConfig" = NEW."permissionConfig", "updatedAt" = now()
    WHERE "permissionPresetId" = NEW."id" AND "organizationId" = NEW."organizationId";
  RETURN NEW;
END;
$$;
CREATE TRIGGER live_permission_preset
  AFTER UPDATE OF "permissionConfig" ON "kublai_organization_permission_preset"
  FOR EACH ROW EXECUTE FUNCTION kublai_propagate_permission_preset();
