ALTER TABLE "kublai_quote_item" ADD COLUMN IF NOT EXISTS "sentOrderItemId" uuid REFERENCES "kublai_order_item"(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS quote_item_sent_order_idx ON "kublai_quote_item" ("sentOrderItemId");
-- Historical rows can only be linked when both sides match uniquely. Never
-- guess which order a repeated/re-edited material row belonged to.
WITH candidates AS (
  SELECT qi.id AS item_id, oi.id AS order_item_id,
    count(*) OVER (PARTITION BY qi.id) AS item_matches,
    count(*) OVER (PARTITION BY oi.id) AS order_matches,
    round(oi.quantity * coalesce(oi."unitCostAtOrderTime", 0), 2) AS total
  FROM kublai_quote_item qi
  JOIN kublai_quote q ON q.id = qi."quoteId"
  JOIN kublai_order o ON o."materialListId" = q."materialListId" AND o."organizationId" = q."organizationId"
  JOIN kublai_order_item oi ON oi."orderId" = o.id
  WHERE qi."sentOrderItemId" IS NULL AND o.kind = 'materials' AND o."sentAt" IS NOT NULL
    AND qi."partDefinitionId" = oi."partDefinitionId"
    AND qi."supplierPartId" IS NOT DISTINCT FROM oi."supplierPartId"
    AND coalesce(qi."supplierId", (SELECT sp."supplierId" FROM kublai_supplier_part sp WHERE sp.id = qi."supplierPartId")) = o."supplierId"
    AND qi."roomId" IS NOT DISTINCT FROM oi."roomId"
    AND qi.quantity = coalesce(oi."requestedQuantity", oi.quantity)
    AND qi."updatedAt" <= o."sentAt"
    AND NOT EXISTS (SELECT 1 FROM kublai_quote_item linked WHERE linked."sentOrderItemId" = oi.id)
)
UPDATE kublai_quote_item qi SET "sentOrderItemId" = c.order_item_id, "extendedPrice" = c.total, "updatedAt" = now()
FROM candidates c WHERE qi.id = c.item_id AND c.item_matches = 1 AND c.order_matches = 1;
