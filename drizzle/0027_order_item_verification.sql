ALTER TABLE "kublai_order_item"
  ADD COLUMN IF NOT EXISTS "receivedQuantity" numeric(12,6) DEFAULT '0' NOT NULL;

ALTER TABLE "kublai_order_item"
  ADD COLUMN IF NOT EXISTS "verificationStatus" varchar(50) DEFAULT 'pending' NOT NULL;
