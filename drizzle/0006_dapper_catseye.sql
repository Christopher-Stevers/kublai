ALTER TABLE "kublai_category" DROP CONSTRAINT "category_org_parent_name_uniq";--> statement-breakpoint
ALTER TABLE "kublai_category" DROP CONSTRAINT "kublai_category_parentId_kublai_category_id_fk";
--> statement-breakpoint
ALTER TABLE "kublai_part_definition" DROP CONSTRAINT "kublai_part_definition_sizeUnitId_kublai_unit_id_fk";
--> statement-breakpoint
DROP INDEX "category_parent_idx";--> statement-breakpoint
DROP INDEX "part_def_facets_idx";--> statement-breakpoint
ALTER TABLE "kublai_category" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD COLUMN "sizeId" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_sizeId_kublai_size_id_fk" FOREIGN KEY ("sizeId") REFERENCES "public"."kublai_size"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "part_def_size_idx" ON "kublai_part_definition" USING btree ("sizeId");--> statement-breakpoint
CREATE INDEX "part_def_facets_idx" ON "kublai_part_definition" USING btree ("partTypeId","materialId","sizeId");--> statement-breakpoint
ALTER TABLE "kublai_category" DROP COLUMN "parentId";--> statement-breakpoint
ALTER TABLE "kublai_part_definition" DROP COLUMN "sizeNominal";--> statement-breakpoint
ALTER TABLE "kublai_part_definition" DROP COLUMN "sizeUnitId";--> statement-breakpoint
ALTER TABLE "kublai_category" ADD CONSTRAINT "category_org_name_uniq" UNIQUE("organizationId","name");