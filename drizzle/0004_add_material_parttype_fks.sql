-- Add materialId and partTypeId columns as nullable UUIDs
ALTER TABLE "kublai_part_definition" ADD COLUMN "materialId" uuid;
ALTER TABLE "kublai_part_definition" ADD COLUMN "partTypeId" uuid;

-- Add foreign key constraints
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_materialId_kublai_material_id_fk" FOREIGN KEY ("materialId") REFERENCES "public"."kublai_material"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_partTypeId_kublai_part_type_id_fk" FOREIGN KEY ("partTypeId") REFERENCES "public"."kublai_part_type"("id") ON DELETE set null ON UPDATE no action;

-- Add indexes
CREATE INDEX "part_def_material_idx" ON "kublai_part_definition" USING btree ("materialId");
CREATE INDEX "part_def_part_type_idx" ON "kublai_part_definition" USING btree ("partTypeId");

-- Update the facets index to use IDs instead of strings
DROP INDEX IF EXISTS "part_def_facets_idx";
CREATE INDEX "part_def_facets_idx" ON "kublai_part_definition" USING btree ("partTypeId", "materialId", "sizeNominal");

