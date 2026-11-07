-- Preserved from drizzle/0039_reliability_revisions.sql
CREATE OR REPLACE FUNCTION kublai_bump_sync_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb;
  org text;
  parent_table text;
  parent_key text;
  scopes text[] := ARRAY[]::text[];
  revision_kind text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN scopes := ARRAY['*'];
  ELSE
    FOR row_data IN SELECT value FROM jsonb_array_elements(
      CASE TG_OP WHEN 'INSERT' THEN jsonb_build_array(to_jsonb(NEW))
      WHEN 'DELETE' THEN jsonb_build_array(to_jsonb(OLD))
      ELSE jsonb_build_array(to_jsonb(OLD), to_jsonb(NEW)) END)
    LOOP
      org := row_data ->> 'organizationId';
      -- Users can be referenced by historical lists after changing organizations.
      IF TG_TABLE_NAME = 'kublai_user' THEN org := NULL;
      ELSIF TG_TABLE_NAME IN ('kublai_quote_item', 'kublai_order_item') THEN
        parent_table := CASE TG_TABLE_NAME WHEN 'kublai_quote_item' THEN 'kublai_quote' ELSE 'kublai_order' END;
        parent_key := CASE TG_TABLE_NAME WHEN 'kublai_quote_item' THEN 'quoteId' ELSE 'orderId' END;
        EXECUTE format('SELECT "organizationId"::text FROM %I.%I WHERE id = $1::uuid', TG_TABLE_SCHEMA, parent_table)
          INTO org USING row_data ->> parent_key;
      END IF;
      scopes := array_append(scopes, coalesce(org, '*'));
    END LOOP;
  END IF;
  FOR revision_kind IN SELECT unnest(string_to_array(TG_ARGV[0], ',')) LOOP
    FOR org IN SELECT DISTINCT unnest(scopes) ORDER BY 1 LOOP
      INSERT INTO kublai_sync_revision(kind, scope, revision) VALUES(revision_kind, org, 1)
        ON CONFLICT(kind, scope) DO UPDATE SET revision = kublai_sync_revision.revision + 1;
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;
DO $$
DECLARE name text; kinds text;
BEGIN
  FOREACH name IN ARRAY ARRAY['catalog','material','category','unit','size','part_definition','job','location','material_list','quote','quote_item','supplier','supplier_part','user','order','order_item'] LOOP
    kinds := CASE WHEN name IN ('catalog','material','category','unit','size','part_definition') THEN 'catalogue,material-lists' ELSE 'material-lists' END;
    EXECUTE format('DROP TRIGGER IF EXISTS sync_revision_row ON %I', 'kublai_' || name);
    EXECUTE format('CREATE TRIGGER sync_revision_row AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kublai_bump_sync_revision(%L)', 'kublai_' || name, kinds);
    EXECUTE format('DROP TRIGGER IF EXISTS sync_revision_truncate ON %I', 'kublai_' || name);
    EXECUTE format('CREATE TRIGGER sync_revision_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION kublai_bump_sync_revision(%L)', 'kublai_' || name, kinds);
  END LOOP;
END $$;

--> statement-breakpoint
-- Preserved from drizzle/0045_material_room.sql
DROP TRIGGER IF EXISTS material_room_name_revision ON kublai_job_room;
CREATE TRIGGER material_room_name_revision
  AFTER UPDATE OF name ON kublai_job_room FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION kublai_bump_sync_revision('material-lists');

--> statement-breakpoint
-- Preserved from drizzle/0057_live_permission_presets.sql
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

--> statement-breakpoint
-- Preserved from drizzle/0058_member_departments_reporting.sql
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

--> statement-breakpoint
-- Preserved from drizzle/0066_estimating.sql
CREATE FUNCTION "kublai_estimating_immutable_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Estimating revision snapshots cannot be updated';
  ELSIF TG_TABLE_NAME = 'kublai_estimate_revision' THEN
    IF EXISTS (SELECT 1 FROM kublai_estimate WHERE id = OLD."estimateId") THEN
      RAISE EXCEPTION 'Estimating revision snapshots cannot be deleted';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM kublai_organization WHERE id = OLD."organizationId") THEN
      RAISE EXCEPTION 'Estimating pricing revision snapshots cannot be deleted';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "estimate_revision_immutable" BEFORE UPDATE OR DELETE ON "kublai_estimate_revision" FOR EACH ROW EXECUTE FUNCTION "kublai_estimating_immutable_revision"();
CREATE TRIGGER "estimating_pricing_revision_immutable" BEFORE UPDATE OR DELETE ON "kublai_estimating_pricing_revision" FOR EACH ROW EXECUTE FUNCTION "kublai_estimating_immutable_revision"();

--> statement-breakpoint
-- Preserved from drizzle/0074_job_pricing.sql
CREATE FUNCTION kublai_check_job_pricing_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='kublai_job_price_list' THEN
  IF NOT EXISTS (SELECT 1 FROM kublai_job WHERE id=NEW."jobId" AND "organizationId"=NEW."organizationId") THEN RAISE EXCEPTION 'Job pricing organization mismatch'; END IF;
 ELSIF TG_TABLE_NAME='kublai_job_price_entry' THEN
  IF NOT EXISTS (SELECT 1 FROM kublai_job_price_list l JOIN kublai_supplier_part s ON s.id=NEW."supplierPartId" JOIN kublai_part_definition p ON p.id=s."partDefinitionId" JOIN kublai_supplier su ON su.id=s."supplierId" WHERE l.id=NEW."priceListId" AND l."organizationId"=s."organizationId" AND p."organizationId"=l."organizationId" AND su."organizationId"=l."organizationId") THEN RAISE EXCEPTION 'Job pricing listing organization mismatch'; END IF;
 ELSE
  IF NOT EXISTS (SELECT 1 FROM kublai_material_list m JOIN kublai_job j ON j.id=m."jobId" JOIN kublai_supplier s ON s.id=NEW."supplierId" WHERE m.id=NEW."materialListId" AND m."jobId"=NEW."jobId" AND j."organizationId"=NEW."organizationId" AND m."organizationId"=NEW."organizationId" AND s."organizationId"=NEW."organizationId") THEN RAISE EXCEPTION 'Job order approval organization mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER job_price_list_scope BEFORE INSERT OR UPDATE ON kublai_job_price_list FOR EACH ROW EXECUTE FUNCTION kublai_check_job_pricing_scope();
CREATE TRIGGER job_price_entry_scope BEFORE INSERT OR UPDATE ON kublai_job_price_entry FOR EACH ROW EXECUTE FUNCTION kublai_check_job_pricing_scope();
CREATE TRIGGER job_order_approval_scope BEFORE INSERT OR UPDATE ON kublai_job_order_approval FOR EACH ROW EXECUTE FUNCTION kublai_check_job_pricing_scope();

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS organization_permission_preset_name_uniq ON kublai_organization_permission_preset ("organizationId", lower(trim(name)));
CREATE INDEX IF NOT EXISTS user_permission_preset_idx ON kublai_user ("permissionPresetId");
CREATE UNIQUE INDEX IF NOT EXISTS organization_department_name_uniq ON kublai_organization_department ("organizationId", lower(btrim(name)));
