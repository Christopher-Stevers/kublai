-- Run against the freshly migrated CI database. All fixtures roll back.
BEGIN;
SET LOCAL ROLE foreman_app;
DO $$
DECLARE
  org_a uuid := gen_random_uuid();
  org_b uuid := gen_random_uuid();
  preset uuid := gen_random_uuid();
  member text := 'aws-migration-test-' || gen_random_uuid();
  config jsonb;
BEGIN
  INSERT INTO kublai_organization(id,name,"createdAt") VALUES
    (org_a,org_a::text,now()),(org_b,org_b::text,now());
  INSERT INTO kublai_organization_permission_preset(id,"organizationId",name,"permissionConfig")
    VALUES(preset,org_a,'Crew','{"test":true}');
  INSERT INTO kublai_user(id,email,"organizationId","permissionPresetId","createdAt","updatedAt")
    VALUES(member,'migration-test@example.invalid',org_a,preset,now(),now());
  SELECT "permissionConfig" INTO config FROM kublai_user WHERE id=member;
  IF config <> '{"test":true}'::jsonb THEN RAISE EXCEPTION 'Preset not applied'; END IF;
  UPDATE kublai_organization_permission_preset SET "permissionConfig"='{"test":false}' WHERE id=preset;
  SELECT "permissionConfig" INTO config FROM kublai_user WHERE id=member;
  IF config <> '{"test":false}'::jsonb THEN RAISE EXCEPTION 'Preset not propagated'; END IF;
  BEGIN
    UPDATE kublai_user SET "organizationId"=org_b WHERE id=member;
    RAISE EXCEPTION 'Cross-organization preset assignment was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT EXISTS(SELECT 1 FROM kublai_sync_revision WHERE kind='material-lists' AND revision>0) THEN
    RAISE EXCEPTION 'Sync revision trigger missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
    ('estimate_revision_immutable','estimating_pricing_revision_immutable','job_price_list_scope','job_price_entry_scope','job_order_approval_scope')) <> 5 THEN
    RAISE EXCEPTION 'Audit or organization-boundary triggers missing';
  END IF;
END $$;
ROLLBACK;

-- PR8 requires these custom tables, triggers and validation rules in addition
-- to the generated schema. Exercise runtime access, and roll everything back.
BEGIN;
SET LOCAL ROLE foreman_app;
DO $$
DECLARE org uuid := gen_random_uuid();
BEGIN
  INSERT INTO kublai_organization(id,name,"createdAt") VALUES (org,'PR8 migration check',now());
  INSERT INTO kublai_order_number_counter ("organizationId","lastNumber") VALUES (org,42);
  UPDATE kublai_order_number_counter SET "lastNumber"="lastNumber"+1 WHERE "organizationId"=org;
  IF (SELECT "lastNumber" FROM kublai_order_number_counter WHERE "organizationId"=org) <> 43 THEN
    RAISE EXCEPTION 'Order counter unavailable';
  END IF;
  PERFORM 1 FROM kublai_diagnostic_count LIMIT 1;
  PERFORM 1 FROM kublai_material_sort_preference LIMIT 1;
  PERFORM 1 FROM kublai_packing_slip_review_history LIMIT 1;
  PERFORM 1 FROM kublai_packing_slip_job WHERE "orderId" IS NULL LIMIT 1;
  PERFORM 1 FROM kublai_packing_slip_terra_call LIMIT 1;
  PERFORM 1 FROM kublai_hyperlink_reader_run LIMIT 1;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
      AND tgrelid IN ('kublai_job_price_list'::regclass,'kublai_job_price_entry'::regclass)
      AND tgname IN ('sync_revision_row','sync_revision_truncate')) <> 4 THEN
    RAISE EXCEPTION 'Job pricing sync triggers missing';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conname IN
      ('packing_slip_job_status_check','packing_slip_terra_call_status_check',
       'packing_slip_terra_call_budget_check','hyperlink_reader_run_reader_check',
       'hyperlink_reader_run_status_check')) <> 5 THEN
    RAISE EXCEPTION 'PR8 worker validation constraints missing';
  END IF;
  BEGIN
    UPDATE kublai_order_number_counter SET "lastNumber"=-1 WHERE "organizationId"=org;
    RAISE EXCEPTION 'Negative order counter accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
ROLLBACK;
