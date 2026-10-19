CREATE TABLE IF NOT EXISTS kublai_supplier_price_book (
 id uuid PRIMARY KEY, "organizationId" uuid NOT NULL REFERENCES kublai_organization(id) ON DELETE CASCADE,
 "supplierId" uuid NOT NULL REFERENCES kublai_supplier(id) ON DELETE CASCADE,
 name varchar(255) NOT NULL, revision integer NOT NULL DEFAULT 1, "createdAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE("supplierId",name)
);
CREATE TABLE IF NOT EXISTS kublai_supplier_price_book_entry (
 id uuid PRIMARY KEY, "bookId" uuid NOT NULL REFERENCES kublai_supplier_price_book(id) ON DELETE CASCADE,
 "supplierPartId" uuid NOT NULL REFERENCES kublai_supplier_part(id) ON DELETE CASCADE,
 "unitCost" numeric(12,4), "priceStatus" varchar(20) NOT NULL DEFAULT 'none',
 "priceBasis" varchar(100) NOT NULL DEFAULT 'each', "priceSource" text, "sourceDescription" text,
 UNIQUE("bookId","supplierPartId"), CHECK("unitCost" IS NULL OR "unitCost">=0),
 CHECK("priceStatus" IN ('none','estimated','confirmed')),
 CHECK(("priceStatus"='none')=("unitCost" IS NULL))
);
CREATE TABLE IF NOT EXISTS kublai_job_supplier_price_book (
 id uuid PRIMARY KEY, "jobId" uuid NOT NULL REFERENCES kublai_job(id) ON DELETE CASCADE,
 "supplierId" uuid NOT NULL REFERENCES kublai_supplier(id) ON DELETE CASCADE,
 "bookId" uuid NOT NULL REFERENCES kublai_supplier_price_book(id) ON DELETE CASCADE,
 UNIQUE("jobId","supplierId")
);
ALTER TABLE kublai_job_price_entry ADD COLUMN IF NOT EXISTS "supplierPriceBookEntryId" uuid REFERENCES kublai_supplier_price_book_entry(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS job_price_entry_supplier_book_idx ON kublai_job_price_entry("supplierPriceBookEntryId");
