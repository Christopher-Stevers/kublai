CREATE TABLE IF NOT EXISTS "kublai_room_detection_job" (
  "floorId" uuid PRIMARY KEY NOT NULL REFERENCES "kublai_job_floor"("id") ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
  "status" varchar(20) NOT NULL,
  "startedAt" timestamp with time zone NOT NULL,
  "heartbeatAt" timestamp with time zone NOT NULL,
  "finishedAt" timestamp with time zone,
  "workerPid" integer,
  "error" text,
  "result" jsonb,
  "log" jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "room_detection_job_org_idx"
  ON "kublai_room_detection_job" ("organizationId");
