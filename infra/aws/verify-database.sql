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
