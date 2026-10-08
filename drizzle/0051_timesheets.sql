CREATE TABLE kublai_time_settings (
 "organizationId" uuid PRIMARY KEY REFERENCES kublai_organization(id) ON DELETE CASCADE,
 cadence varchar(10) NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('daily','weekly')),
 "weekStartsOn" integer NOT NULL DEFAULT 1 CHECK ("weekStartsOn" BETWEEN 0 AND 6),
 timezone varchar(100) NOT NULL DEFAULT 'America/Toronto', revision integer NOT NULL DEFAULT 0,
 "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kublai_time_sheet (
 id uuid PRIMARY KEY, "organizationId" uuid NOT NULL REFERENCES kublai_organization(id) ON DELETE CASCADE,
 "userId" varchar(255) NOT NULL REFERENCES kublai_user(id) ON DELETE RESTRICT,
 "startDate" date NOT NULL, "endDate" date NOT NULL, status varchar(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','returned')),
 revision integer NOT NULL DEFAULT 0, "reviewNote" text NOT NULL DEFAULT '', "submittedAt" timestamptz, "reviewedAt" timestamptz,
 "reviewerId" varchar(255) REFERENCES kublai_user(id) ON DELETE SET NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT time_sheet_period_unique UNIQUE("organizationId","userId","startDate"), CHECK ("endDate" >= "startDate" AND "endDate" <= "startDate" + 6)
);
CREATE INDEX time_sheet_org_period_idx ON kublai_time_sheet("organizationId","startDate");
CREATE TABLE kublai_time_entry (
 id uuid PRIMARY KEY, "sheetId" uuid NOT NULL REFERENCES kublai_time_sheet(id) ON DELETE CASCADE,
 date date NOT NULL, "jobId" uuid REFERENCES kublai_job(id) ON DELETE SET NULL, "jobName" varchar(255) NOT NULL DEFAULT 'General', category varchar(20) NOT NULL DEFAULT 'work',
 minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 1440), "breakMinutes" integer NOT NULL DEFAULT 0 CHECK("breakMinutes" BETWEEN 0 AND 1440),
 "costCode" varchar(100) NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', source varchar(10) NOT NULL DEFAULT 'manual',
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), CHECK(minutes + "breakMinutes" <= 1440)
);
CREATE INDEX time_entry_sheet_idx ON kublai_time_entry("sheetId");
CREATE TABLE kublai_time_clock (
 id uuid PRIMARY KEY, "organizationId" uuid NOT NULL REFERENCES kublai_organization(id) ON DELETE CASCADE,
 "userId" varchar(255) NOT NULL REFERENCES kublai_user(id) ON DELETE RESTRICT,
 "jobId" uuid REFERENCES kublai_job(id) ON DELETE SET NULL, "jobName" varchar(255) NOT NULL DEFAULT 'General', notes text NOT NULL DEFAULT '',
 timezone varchar(100) NOT NULL, periods jsonb NOT NULL, revision integer NOT NULL DEFAULT 0, "startedAt" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT time_clock_user_unique UNIQUE("organizationId","userId")
);
CREATE TABLE kublai_time_event (
 id uuid PRIMARY KEY, "organizationId" uuid NOT NULL REFERENCES kublai_organization(id) ON DELETE CASCADE,
 "sheetId" uuid REFERENCES kublai_time_sheet(id) ON DELETE CASCADE, "userId" varchar(255) NOT NULL, "actorId" varchar(255) NOT NULL,
 "actorName" varchar(255) NOT NULL, action varchar(50) NOT NULL, data jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_event_sheet_idx ON kublai_time_event("sheetId","createdAt");

CREATE INDEX time_event_org_idx ON kublai_time_event("organizationId","createdAt",id);
CREATE INDEX time_event_user_idx ON kublai_time_event("organizationId","userId","createdAt",id);
