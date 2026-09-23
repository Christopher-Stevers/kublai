ALTER TABLE "kublai_replicache_client_group"
  ADD COLUMN IF NOT EXISTS "lastPullOrder" bigint NOT NULL DEFAULT 0;
