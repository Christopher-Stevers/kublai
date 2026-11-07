ALTER TABLE kublai_room_detection_job ADD COLUMN IF NOT EXISTS "runId" uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE kublai_room_detection_job ADD COLUMN IF NOT EXISTS "workerBootId" text;
ALTER TABLE kublai_room_detection_job ADD COLUMN IF NOT EXISTS "workerStartTicks" text;
CREATE TABLE IF NOT EXISTS kublai_sync_revision (
  kind text NOT NULL,
  scope text NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(kind, scope)
);
-- Counters commit/roll back with source writes, including direct SQL and deletes.
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
