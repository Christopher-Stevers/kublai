CREATE TABLE IF NOT EXISTS "kublai_employee_simulation_session" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tokenHash" varchar(64) NOT NULL,
 "organizationId" uuid NOT NULL REFERENCES "kublai_organization"("id") ON DELETE CASCADE,
 "actorId" varchar(255) NOT NULL, "employeeId" varchar(255) NOT NULL,
 "actorName" varchar(255) NOT NULL, "employeeName" varchar(255) NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "expiresAt" timestamptz NOT NULL, "endedAt" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "simulation_token_hash_unique" ON "kublai_employee_simulation_session"("tokenHash");
CREATE INDEX IF NOT EXISTS "simulation_actor_created_idx" ON "kublai_employee_simulation_session"("actorId","createdAt");
CREATE TABLE IF NOT EXISTS "kublai_employee_simulation_audit" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "sessionId" uuid NOT NULL REFERENCES "kublai_employee_simulation_session"("id") ON DELETE CASCADE,
 "action" varchar(512) NOT NULL, "outcome" varchar(32) NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "simulation_audit_session_created_idx" ON "kublai_employee_simulation_audit"("sessionId","createdAt");
