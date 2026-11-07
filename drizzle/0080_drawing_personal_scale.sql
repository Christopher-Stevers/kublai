CREATE TABLE IF NOT EXISTS kublai_drawing_personal_scale (
 "sheetId" uuid NOT NULL REFERENCES kublai_job_drawing_sheet(id) ON DELETE CASCADE,
 "userId" varchar(255) NOT NULL REFERENCES kublai_user(id) ON DELETE CASCADE,
 scale jsonb NOT NULL,
 PRIMARY KEY ("sheetId", "userId")
);
