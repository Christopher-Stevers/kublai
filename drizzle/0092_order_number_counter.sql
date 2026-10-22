CREATE TABLE IF NOT EXISTS kublai_order_number_counter (
  "organizationId" uuid PRIMARY KEY REFERENCES kublai_organization(id) ON DELETE CASCADE,
  "lastNumber" integer NOT NULL CHECK ("lastNumber" >= 0)
);
-- Seed from legacy references across every job and supplier in the company.
INSERT INTO kublai_order_number_counter ("organizationId", "lastNumber")
SELECT "organizationId", coalesce(max(substring("orderNumber" from '^(?:ORDER-|PO-)?([0-9]{1,9})(?:-|$)')::int), 0)
FROM kublai_order WHERE kind = 'materials' GROUP BY "organizationId"
ON CONFLICT ("organizationId") DO UPDATE
SET "lastNumber" = greatest(kublai_order_number_counter."lastNumber", excluded."lastNumber");
