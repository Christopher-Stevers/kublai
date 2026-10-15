ALTER TABLE kublai_order_item ADD COLUMN IF NOT EXISTS "priceStatusSnapshot" varchar(20);
CREATE TABLE "kublai_job_price_list" (
 "id" uuid PRIMARY KEY, "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
 "jobId" uuid NOT NULL UNIQUE REFERENCES "kublai_job"("id") ON DELETE CASCADE,
 "name" varchar(255) NOT NULL,"currency" varchar(10) NOT NULL DEFAULT 'CAD',
 "active" boolean NOT NULL DEFAULT true,"requireApproval" boolean NOT NULL DEFAULT true,"revision" integer NOT NULL DEFAULT 1,"updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_price_list_org_idx ON kublai_job_price_list ("organizationId");
CREATE TABLE "kublai_job_price_entry" (
 "id" uuid PRIMARY KEY,"priceListId" uuid NOT NULL REFERENCES "kublai_job_price_list"("id") ON DELETE CASCADE,
 "supplierPartId" uuid NOT NULL REFERENCES "kublai_supplier_part"("id") ON DELETE RESTRICT,
 "sourceDescription" text,"unitCost" numeric(12,4),"priceStatus" varchar(20) NOT NULL DEFAULT 'none',
 "priceBasis" varchar(100) NOT NULL DEFAULT 'each',"priceSource" text,"active" boolean NOT NULL DEFAULT true,"updatedAt" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT job_price_entry_listing_uniq UNIQUE ("priceListId","supplierPartId"),
 CONSTRAINT job_price_entry_cost_check CHECK ("unitCost" IS NULL OR "unitCost">=0),
 CONSTRAINT job_price_entry_status_check CHECK ("priceStatus" IN ('none','estimated','confirmed')),
 CONSTRAINT job_price_entry_status_cost_check CHECK (("priceStatus"='none' AND "unitCost" IS NULL) OR ("priceStatus"<>'none' AND "unitCost" IS NOT NULL))
);
CREATE TABLE "kublai_job_order_approval" (
 "id" uuid PRIMARY KEY,"organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
 "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
 "materialListId" uuid NOT NULL REFERENCES "kublai_material_list"("id") ON DELETE CASCADE,
 "supplierId" uuid NOT NULL REFERENCES "kublai_supplier"("id") ON DELETE RESTRICT,
 "fingerprint" varchar(64) NOT NULL,"status" varchar(20) NOT NULL DEFAULT 'pending',"snapshot" jsonb NOT NULL,
 "requestNote" text NOT NULL,"reviewNote" text,"requestedBy" varchar(255) REFERENCES kublai_user(id) ON DELETE SET NULL,
 "requestedByActor" varchar(255) REFERENCES kublai_user(id) ON DELETE SET NULL,"reviewedBy" varchar(255) REFERENCES kublai_user(id) ON DELETE SET NULL,
 "reviewedByActor" varchar(255) REFERENCES kublai_user(id) ON DELETE SET NULL,"createdAt" timestamptz NOT NULL DEFAULT now(),"reviewedAt" timestamptz,"usedAt" timestamptz,
 CONSTRAINT job_order_approval_content_uniq UNIQUE ("organizationId","materialListId","supplierId","fingerprint"),
 CONSTRAINT job_order_approval_status_check CHECK ("status" IN ('pending','approved','rejected','superseded'))
);
CREATE INDEX job_order_approval_queue_idx ON kublai_job_order_approval ("organizationId","jobId","status");
CREATE TABLE "kublai_job_pricing_audit" (
 "id" uuid PRIMARY KEY,"organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
 "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,"action" varchar(60) NOT NULL,"detail" jsonb NOT NULL,
 "userId" varchar(255) REFERENCES kublai_user(id) ON DELETE SET NULL,"actorUserId" varchar(255) REFERENCES kublai_user(id) ON DELETE SET NULL,"createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_pricing_audit_job_idx ON kublai_job_pricing_audit ("organizationId","jobId","createdAt");
-- Cross-tenant protection also applies to maintenance scripts and future endpoints.
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
