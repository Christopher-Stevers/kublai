-- Quoted tags are part of downloaded job material lists. Pricing changes must
-- invalidate that snapshot too. Entry rows without organizationId use the
-- existing global fallback in kublai_bump_sync_revision.
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['job_price_list', 'job_price_entry'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sync_revision_row ON %I', 'kublai_' || name);
    EXECUTE format('CREATE TRIGGER sync_revision_row AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kublai_bump_sync_revision(%L)', 'kublai_' || name, 'material-lists');
    EXECUTE format('DROP TRIGGER IF EXISTS sync_revision_truncate ON %I', 'kublai_' || name);
    EXECUTE format('CREATE TRIGGER sync_revision_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION kublai_bump_sync_revision(%L)', 'kublai_' || name, 'material-lists');
  END LOOP;
END $$;
