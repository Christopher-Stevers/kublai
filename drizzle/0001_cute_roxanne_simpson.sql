ALTER TABLE "kublai_backfill" DROP CONSTRAINT "kublai_backfill_boardId_kublai_board_id_fk";
--> statement-breakpoint
ALTER TABLE "kublai_backfill"
ADD COLUMN "orderId" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "kublai_board_type"
ADD COLUMN "slotCostPerDay" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "kublai_board_type"
ADD COLUMN "backfillCostPerDay" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "kublai_creative"
ADD COLUMN "userId" varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE "kublai_creative"
ADD COLUMN "fileType" varchar(50) NOT NULL;
--> statement-breakpoint
ALTER TABLE "kublai_creative"
ADD COLUMN "filePath" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "kublai_creative"
ADD COLUMN "fileSize" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "kublai_creative"
ADD COLUMN "mimeType" varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE "kublai_creative"
ADD COLUMN "approvedBy" varchar(255);
--> statement-breakpoint
ALTER TABLE "kublai_creative"
ADD COLUMN "approvedAt" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "kublai_order"
ADD COLUMN "approved" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "kublai_order"
ADD COLUMN "approvedBy" varchar(255);
--> statement-breakpoint
ALTER TABLE "kublai_order"
ADD COLUMN "approvedAt" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "kublai_slot"
ADD COLUMN "orderId" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "kublai_user"
ADD COLUMN "role" varchar(50) DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE "kublai_backfill"
ADD CONSTRAINT "kublai_backfill_orderId_kublai_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."kublai_order"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_creative"
ADD CONSTRAINT "kublai_creative_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_creative"
ADD CONSTRAINT "kublai_creative_approvedBy_kublai_user_id_fk" FOREIGN KEY ("approvedBy") REFERENCES "public"."kublai_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_order"
ADD CONSTRAINT "kublai_order_approvedBy_kublai_user_id_fk" FOREIGN KEY ("approvedBy") REFERENCES "public"."kublai_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_slot"
ADD CONSTRAINT "kublai_slot_orderId_kublai_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."kublai_order"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "slot_board_time_idx" ON "kublai_slot" USING btree ("boardId", "startTime", "endTime");
--> statement-breakpoint
CREATE INDEX "slot_order_id_idx" ON "kublai_slot" USING btree ("orderId");
--> statement-breakpoint
ALTER TABLE "kublai_backfill" DROP COLUMN "boardId";