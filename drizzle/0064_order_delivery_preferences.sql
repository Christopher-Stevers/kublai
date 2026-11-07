CREATE TABLE IF NOT EXISTS "kublai_order_delivery_preferences" (
  "userId" varchar(255) PRIMARY KEY REFERENCES "kublai_user"("id") ON DELETE CASCADE,
  "calendar" jsonb NOT NULL,
  "revision" integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
