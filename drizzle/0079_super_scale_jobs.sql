CREATE TABLE IF NOT EXISTS kublai_super_scale_job (
 id uuid PRIMARY KEY, "userId" varchar(255) NOT NULL REFERENCES kublai_user(id) ON DELETE CASCADE,
 "organizationId" uuid NOT NULL REFERENCES kublai_organization(id) ON DELETE CASCADE,
 "sheetId" uuid NOT NULL REFERENCES kublai_job_drawing_sheet(id) ON DELETE CASCADE,
 first text NOT NULL DEFAULT '', second text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
 progress text NOT NULL DEFAULT 'Queued', attempts integer NOT NULL DEFAULT 0,
 output jsonb, error text, "createdAt" timestamptz NOT NULL DEFAULT now(), "finishedAt" timestamptz
);
CREATE INDEX IF NOT EXISTS super_scale_user_sheet_idx ON kublai_super_scale_job("userId","sheetId","createdAt");
CREATE INDEX IF NOT EXISTS super_scale_queue_idx ON kublai_super_scale_job(status,"createdAt");
