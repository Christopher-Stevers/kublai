-- Preserve demand separately from the supplier-adjusted quantity on new orders.
-- Existing orders keep their original quantities and have no inferred demand.
ALTER TABLE "kublai_order_item" ADD COLUMN IF NOT EXISTS "requestedQuantity" numeric(12,6);
ALTER TABLE "kublai_order_item" ADD COLUMN IF NOT EXISTS "orderMultipleSnapshot" numeric(12,6);
