DROP INDEX "part_def_facets_idx";--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD COLUMN "partTypeId" uuid;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD COLUMN "materialId" uuid;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_partTypeId_kublai_part_type_id_fk" FOREIGN KEY ("partTypeId") REFERENCES "public"."kublai_part_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_materialId_kublai_material_id_fk" FOREIGN KEY ("materialId") REFERENCES "public"."kublai_material"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "part_def_material_idx" ON "kublai_part_definition" USING btree ("materialId");--> statement-breakpoint
CREATE INDEX "part_def_part_type_idx" ON "kublai_part_definition" USING btree ("partTypeId");--> statement-breakpoint
CREATE INDEX "part_def_facets_idx" ON "kublai_part_definition" USING btree ("partTypeId","materialId","sizeNominal");--> statement-breakpoint
ALTER TABLE "kublai_part_definition" DROP COLUMN "partType";--> statement-breakpoint
ALTER TABLE "kublai_part_definition" DROP COLUMN "material";