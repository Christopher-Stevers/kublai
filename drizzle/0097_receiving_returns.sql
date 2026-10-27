ALTER TABLE kublai_order_item ADD COLUMN IF NOT EXISTS "returnedQuantity" numeric(12,6) NOT NULL DEFAULT 0;
ALTER TABLE kublai_order_item ADD COLUMN IF NOT EXISTS "creditedQuantity" numeric(12,6) NOT NULL DEFAULT 0;

ALTER TABLE kublai_packing_slip_job ALTER COLUMN "orderId" DROP NOT NULL;
