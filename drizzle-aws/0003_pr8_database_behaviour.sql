-- Preserve custom database behaviour from PR8 that schema generation cannot infer.
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

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kublai_order_number_counter (
  "organizationId" uuid PRIMARY KEY REFERENCES kublai_organization(id) ON DELETE CASCADE,
  "lastNumber" integer NOT NULL CHECK ("lastNumber" >= 0)
);
-- Seed from legacy references across every job and supplier in the company.
INSERT INTO kublai_order_number_counter ("organizationId", "lastNumber")
SELECT "organizationId", coalesce(max(substring("orderNumber" from '^(?:ORDER-|PO-)?([0-9]{1,9})(?:-|$)')::int), 0)
FROM kublai_order WHERE kind = 'materials' GROUP BY "organizationId"
ON CONFLICT ("organizationId") DO UPDATE
SET "lastNumber" = greatest(kublai_order_number_counter."lastNumber", excluded."lastNumber");

--> statement-breakpoint
ALTER TABLE kublai_packing_slip_job ADD CONSTRAINT packing_slip_job_status_check CHECK (status IN ('queued','running','done','failed'));
--> statement-breakpoint
ALTER TABLE kublai_packing_slip_terra_call ADD CONSTRAINT packing_slip_terra_call_status_check CHECK (status IN ('reserved','done','failed'));
--> statement-breakpoint
ALTER TABLE kublai_packing_slip_terra_call ADD CONSTRAINT packing_slip_terra_call_budget_check CHECK ("budgetUsd" >= 0);
--> statement-breakpoint
ALTER TABLE kublai_hyperlink_reader_run ADD CONSTRAINT hyperlink_reader_run_reader_check CHECK (reader IN ('terra','deepseek'));
--> statement-breakpoint
ALTER TABLE kublai_hyperlink_reader_run ADD CONSTRAINT hyperlink_reader_run_status_check CHECK (status IN ('reserved','done','failed'));
