ALTER TABLE kublai_job_room ADD COLUMN IF NOT EXISTS "reviewStatus" varchar(20) NOT NULL DEFAULT 'pending';
ALTER TABLE kublai_job_room ADD COLUMN IF NOT EXISTS detection jsonb;
UPDATE kublai_job_room SET "reviewStatus"='approved' WHERE confirmed=true;
CREATE TABLE IF NOT EXISTS kublai_room_detection_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "organizationId" uuid NOT NULL REFERENCES kublai_organization(id) ON DELETE CASCADE,
 "jobId" uuid NOT NULL REFERENCES kublai_job(id) ON DELETE CASCADE,
 "floorId" uuid NOT NULL REFERENCES kublai_job_floor(id) ON DELETE CASCADE,
 "roomId" uuid NOT NULL,
 "userId" varchar(255) REFERENCES kublai_user(id) ON DELETE SET NULL,
 decision varchar(20) NOT NULL CHECK (decision IN ('approved','rejected','pending','corrected')),
 "drawingKey" text NOT NULL,
 name varchar(255) NOT NULL,
 "proposalShape" jsonb NOT NULL,
 "correctedShape" jsonb,
 detection jsonb,
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_feedback_floor_idx ON kublai_room_detection_feedback("organizationId","floorId","createdAt");
CREATE INDEX IF NOT EXISTS room_feedback_room_idx ON kublai_room_detection_feedback("roomId","createdAt");
