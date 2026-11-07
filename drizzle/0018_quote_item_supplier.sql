ALTER TABLE "kublai_quote_item"
  DROP COLUMN IF EXISTS "supplier_id";

ALTER TABLE "kublai_quote_item"
  ADD COLUMN IF NOT EXISTS "supplierId" uuid;

DO $$ BEGIN
  ALTER TABLE "kublai_quote_item"
    ADD CONSTRAINT "kublai_quote_item_supplierId_kublai_supplier_id_fk"
    FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE "kublai_quote_item" qi
SET "supplierId" = sp."supplierId"
FROM "kublai_supplier_part" sp
WHERE qi."supplierPartId" = sp."id"
  AND qi."supplierId" IS NULL;

CREATE INDEX IF NOT EXISTS "quote_item_supplier_idx"
  ON "kublai_quote_item" ("supplierId");
