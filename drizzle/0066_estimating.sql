CREATE UNIQUE INDEX IF NOT EXISTS "estimating_job_org_unique" ON "kublai_job" ("id", "organizationId");
CREATE TABLE "kublai_estimate" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization" ("id") ON DELETE CASCADE,
  "jobId" uuid NOT NULL,
  "name" varchar(255) NOT NULL CHECK (length(btrim("name")) > 0),
  "status" varchar(20) NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft','in_review','approved','sent','won','lost','archived')),
  "revision" integer NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "document" jsonb NOT NULL CHECK (coalesce(jsonb_typeof("document") = 'object' AND "document"->>'version' = '1' AND CASE WHEN jsonb_typeof("document"->'lines') = 'array' THEN jsonb_array_length("document"->'lines') <= 2000 ELSE false END, false)),
  "summary" jsonb NOT NULL CHECK (jsonb_typeof("summary") = 'object'),
  "createdByUserId" varchar(255) NOT NULL,
  "createdByName" varchar(255) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "estimate_id_org_unique" UNIQUE ("id", "organizationId"),
  CONSTRAINT "estimate_job_org_fk" FOREIGN KEY ("jobId", "organizationId") REFERENCES "kublai_job" ("id", "organizationId") ON DELETE CASCADE
);
CREATE INDEX "estimate_org_updated_idx" ON "kublai_estimate" ("organizationId", "updatedAt", "id");
CREATE INDEX "estimate_job_status_idx" ON "kublai_estimate" ("organizationId", "jobId", "status");
CREATE TABLE "kublai_estimate_revision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "estimateId" uuid NOT NULL,
  "organizationId" uuid NOT NULL,
  "revision" integer NOT NULL CHECK ("revision" > 0),
  "name" varchar(255) NOT NULL,
  "status" varchar(20) NOT NULL CHECK ("status" IN ('draft','in_review','approved','sent','won','lost','archived')),
  "document" jsonb NOT NULL,
  "summary" jsonb NOT NULL CHECK (jsonb_typeof("summary") = 'object'),
  "action" varchar(80) NOT NULL,
  "actorId" varchar(255) NOT NULL,
  "actorName" varchar(255) NOT NULL,
  "effectiveUserId" varchar(255) NOT NULL,
  "effectiveUserName" varchar(255) NOT NULL,
  "simulationId" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "estimate_revision_estimate_org_fk" FOREIGN KEY ("estimateId", "organizationId") REFERENCES "kublai_estimate" ("id", "organizationId") ON DELETE CASCADE,
  CONSTRAINT "estimate_revision_unique" UNIQUE ("estimateId", "revision")
);
CREATE INDEX "estimate_revision_org_idx" ON "kublai_estimate_revision" ("organizationId", "estimateId", "createdAt");
CREATE TABLE "kublai_estimating_pricing" (
  "organizationId" uuid PRIMARY KEY REFERENCES "kublai_organization" ("id") ON DELETE CASCADE,
  "revision" integer NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "rows" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (CASE WHEN jsonb_typeof("rows") = 'array' THEN jsonb_array_length("rows") <= 10000 ELSE false END),
  "assemblies" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (CASE WHEN jsonb_typeof("assemblies") = 'array' THEN jsonb_array_length("assemblies") <= 500 ELSE false END),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "kublai_estimating_pricing_revision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization" ("id") ON DELETE CASCADE,
  "revision" integer NOT NULL CHECK ("revision" > 0),
  "rows" jsonb NOT NULL,
  "assemblies" jsonb NOT NULL,
  "actorId" varchar(255) NOT NULL,
  "actorName" varchar(255) NOT NULL,
  "effectiveUserId" varchar(255) NOT NULL,
  "effectiveUserName" varchar(255) NOT NULL,
  "simulationId" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "estimating_pricing_revision_unique" UNIQUE ("organizationId", "revision")
);
-- Audit content survives status changes and restore operations. Application
-- writes append new revisions; database updates of historical snapshots fail.
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
