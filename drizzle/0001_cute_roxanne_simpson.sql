ALTER TABLE "genghis_backfill" DROP CONSTRAINT "genghis_backfill_boardId_genghis_board_id_fk";
--> statement-breakpoint
ALTER TABLE "genghis_backfill" ADD COLUMN "orderId" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "genghis_board_type" ADD COLUMN "slotCostPerDay" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "genghis_board_type" ADD COLUMN "backfillCostPerDay" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "genghis_creative" ADD COLUMN "userId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "genghis_creative" ADD COLUMN "fileType" varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE "genghis_creative" ADD COLUMN "filePath" text NOT NULL;--> statement-breakpoint
ALTER TABLE "genghis_creative" ADD COLUMN "fileSize" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "genghis_creative" ADD COLUMN "mimeType" varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE "genghis_creative" ADD COLUMN "approvedBy" varchar(255);--> statement-breakpoint
ALTER TABLE "genghis_creative" ADD COLUMN "approvedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "genghis_order" ADD COLUMN "approved" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "genghis_order" ADD COLUMN "approvedBy" varchar(255);--> statement-breakpoint
ALTER TABLE "genghis_order" ADD COLUMN "approvedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "genghis_slot" ADD COLUMN "orderId" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "genghis_user" ADD COLUMN "role" varchar(50) DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "genghis_backfill" ADD CONSTRAINT "genghis_backfill_orderId_genghis_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."genghis_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genghis_creative" ADD CONSTRAINT "genghis_creative_userId_genghis_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."genghis_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genghis_creative" ADD CONSTRAINT "genghis_creative_approvedBy_genghis_user_id_fk" FOREIGN KEY ("approvedBy") REFERENCES "public"."genghis_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genghis_order" ADD CONSTRAINT "genghis_order_approvedBy_genghis_user_id_fk" FOREIGN KEY ("approvedBy") REFERENCES "public"."genghis_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genghis_slot" ADD CONSTRAINT "genghis_slot_orderId_genghis_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."genghis_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slot_board_time_idx" ON "genghis_slot" USING btree ("boardId","startTime","endTime");--> statement-breakpoint
CREATE INDEX "slot_order_id_idx" ON "genghis_slot" USING btree ("orderId");--> statement-breakpoint
ALTER TABLE "genghis_backfill" DROP COLUMN "boardId";