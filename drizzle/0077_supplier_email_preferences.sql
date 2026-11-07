CREATE TABLE IF NOT EXISTS "kublai_supplier_email_preference" (
 "userId" varchar(255) NOT NULL REFERENCES "kublai_user"(id) ON DELETE CASCADE,
 "supplierId" uuid NOT NULL REFERENCES "kublai_supplier"(id) ON DELETE CASCADE,
 "organizationId" uuid NOT NULL REFERENCES "kublai_organization"(id) ON DELETE CASCADE,
 "includeSupplierSku" boolean NOT NULL DEFAULT false,
 PRIMARY KEY ("userId", "supplierId")
);
