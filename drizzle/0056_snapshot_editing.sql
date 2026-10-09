ALTER TABLE "kublai_conversation_message"
  ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "editedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "editClientId" uuid,
  ADD COLUMN IF NOT EXISTS "editRequestHash" varchar(64);
