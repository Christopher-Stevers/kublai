ALTER TABLE "kublai_quote_item" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone NOT NULL DEFAULT now();
