-- Drawings: per-job folders of plain drawing sheets (no room detection).
CREATE TABLE IF NOT EXISTS kublai_job_drawing_set (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES kublai_organization("id") ON DELETE CASCADE,
  "jobId" uuid NOT NULL REFERENCES kublai_job("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "createdByUserId" varchar(255),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS job_drawing_set_job_idx
  ON kublai_job_drawing_set ("organizationId", "jobId");

CREATE TABLE IF NOT EXISTS kublai_job_drawing_sheet (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES kublai_organization("id") ON DELETE CASCADE,
  "jobId" uuid NOT NULL REFERENCES kublai_job("id") ON DELETE CASCADE,
  "setId" uuid NOT NULL REFERENCES kublai_job_drawing_set("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "imageUrl" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "sortOrder" integer DEFAULT 0 NOT NULL,
  "sourceFilename" varchar(255),
  "uploadedByUserId" varchar(255),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS job_drawing_sheet_set_idx
  ON kublai_job_drawing_sheet ("setId", "sortOrder");
