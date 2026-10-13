CREATE TABLE "kublai_quantity_unit" (
  "organizationId" uuid NOT NULL REFERENCES "kublai_organization"(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL CONSTRAINT "quantity_unit_kind" CHECK (kind IN ('bulk', 'individual')),
  name varchar(32) NOT NULL CONSTRAINT "quantity_unit_name" CHECK (length(trim(name)) > 0),
  PRIMARY KEY ("organizationId", kind, name)
);
