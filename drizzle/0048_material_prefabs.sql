-- Prefabs: company-wide named sets of parts added to material lists in one go.
CREATE TABLE IF NOT EXISTS kublai_material_prefab (
  "id" uuid PRIMARY KEY NOT NULL,
  "organizationId" uuid NOT NULL REFERENCES kublai_organization("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "createdByUserId" varchar(255),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS material_prefab_org_idx
  ON kublai_material_prefab ("organizationId", "name");

CREATE TABLE IF NOT EXISTS kublai_material_prefab_item (
  "id" uuid PRIMARY KEY NOT NULL,
  "prefabId" uuid NOT NULL REFERENCES kublai_material_prefab("id") ON DELETE CASCADE,
  "partDefinitionId" uuid NOT NULL REFERENCES kublai_part_definition("id") ON DELETE CASCADE,
  "supplierPartId" uuid REFERENCES kublai_supplier_part("id") ON DELETE SET NULL,
  "quantity" numeric(12, 6) DEFAULT '1' NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT material_prefab_item_part_uniq UNIQUE ("prefabId", "partDefinitionId")
);
