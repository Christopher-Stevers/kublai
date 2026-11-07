CREATE TABLE IF NOT EXISTS "kublai_job_floor_plan" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
  "originalFilename" varchar(255) NOT NULL,
  "storageKey" varchar(512) NOT NULL,
  "status" varchar(50) DEFAULT 'processing' NOT NULL,
  "pageCount" integer DEFAULT 0 NOT NULL,
  "error" text,
  "uploadedByUserId" varchar(255),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "job_floor_plan_job_uniq" UNIQUE("jobId")
);

CREATE INDEX IF NOT EXISTS "job_floor_plan_org_idx"
  ON "kublai_job_floor_plan" ("organizationId");

CREATE TABLE IF NOT EXISTS "kublai_job_floor" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
  "floorPlanId" uuid NOT NULL REFERENCES "kublai_job_floor_plan"("id") ON DELETE CASCADE,
  "pageNumber" integer NOT NULL,
  "name" varchar(255) NOT NULL,
  "imageUrl" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "status" varchar(50) DEFAULT 'detected' NOT NULL,
  "confirmedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "job_floor_plan_page_uniq" UNIQUE("floorPlanId", "pageNumber")
);

CREATE INDEX IF NOT EXISTS "job_floor_job_idx"
  ON "kublai_job_floor" ("jobId");
CREATE INDEX IF NOT EXISTS "job_floor_plan_idx"
  ON "kublai_job_floor" ("floorPlanId");

CREATE TABLE IF NOT EXISTS "kublai_job_room" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "jobId" uuid NOT NULL REFERENCES "kublai_job"("id") ON DELETE CASCADE,
  "floorId" uuid NOT NULL REFERENCES "kublai_job_floor"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "source" varchar(50) DEFAULT 'auto' NOT NULL,
  "confirmed" boolean DEFAULT false NOT NULL,
  "shape" jsonb NOT NULL,
  "sortOrder" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "job_room_floor_idx"
  ON "kublai_job_room" ("floorId");
CREATE INDEX IF NOT EXISTS "job_room_job_idx"
  ON "kublai_job_room" ("jobId");
