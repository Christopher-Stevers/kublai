ALTER TABLE "kublai_job_drawing_set" ADD COLUMN "parentId" uuid;--> statement-breakpoint
ALTER TABLE "kublai_order" ADD COLUMN "previousOrderNumbers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "kublai_job_drawing_set" ADD CONSTRAINT "kublai_job_drawing_set_parentId_kublai_job_drawing_set_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."kublai_job_drawing_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_drawing_set_parent_idx" ON "kublai_job_drawing_set" USING btree ("parentId");