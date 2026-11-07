ALTER TABLE "kublai_order" ADD COLUMN IF NOT EXISTS "materialListId" uuid;
--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD COLUMN IF NOT EXISTS "addedByUserId" varchar(255);
--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD COLUMN IF NOT EXISTS "createdAt" timestamp with time zone;
--> statement-breakpoint
UPDATE "kublai_quote_item" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;
--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ALTER COLUMN "createdAt" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kublai_order" ADD CONSTRAINT "kublai_order_materialListId_kublai_material_list_id_fk" FOREIGN KEY ("materialListId") REFERENCES "public"."kublai_material_list"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_addedByUserId_kublai_user_id_fk" FOREIGN KEY ("addedByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_material_list_idx" ON "kublai_order" USING btree ("materialListId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_item_added_by_idx" ON "kublai_quote_item" USING btree ("addedByUserId");
