CREATE TABLE "kublai_diagnostic_count" (
	"organization_id" uuid NOT NULL,
	"day" date DEFAULT now() NOT NULL,
	"kind" varchar(32) NOT NULL,
	"feature" varchar(24) NOT NULL,
	"device" varchar(12) NOT NULL,
	"release" varchar(40) NOT NULL,
	"code" varchar(24) NOT NULL,
	"duration" varchar(16) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "kublai_diagnostic_count_organization_id_day_kind_feature_device_release_code_duration_pk" PRIMARY KEY("organization_id","day","kind","feature","device","release","code","duration")
);
--> statement-breakpoint
CREATE TABLE "kublai_hyperlink_reader_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"sourceSheetId" uuid NOT NULL,
	"userId" text NOT NULL,
	"reader" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"error" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_material_sort_preference" (
	"organization_id" uuid NOT NULL,
	"scope" varchar(255) NOT NULL,
	"settings" jsonb NOT NULL,
	"custom" boolean DEFAULT false NOT NULL,
	CONSTRAINT "kublai_material_sort_preference_organization_id_scope_pk" PRIMARY KEY("organization_id","scope")
);
--> statement-breakpoint
CREATE TABLE "kublai_packing_slip_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"documentId" uuid NOT NULL,
	"orderId" uuid,
	"versionId" uuid NOT NULL,
	"userId" varchar(255) NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"workerId" uuid,
	"leaseUntil" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_packing_slip_review_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"documentId" uuid NOT NULL,
	"versionId" uuid NOT NULL,
	"runId" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"userId" varchar(255) NOT NULL,
	"release" varchar(100) NOT NULL,
	"data" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packing_slip_history_kind_check" CHECK ("kublai_packing_slip_review_history"."kind" in ('analysis', 'failure', 'confirmation'))
);
--> statement-breakpoint
CREATE TABLE "kublai_packing_slip_terra_call" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"documentId" uuid NOT NULL,
	"versionId" uuid NOT NULL,
	"sourceHash" text NOT NULL,
	"requestHash" text NOT NULL,
	"status" text NOT NULL,
	"budgetUsd" double precision NOT NULL,
	"result" jsonb,
	"error" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kublai_job_drawing_set" ADD COLUMN "labelBoxes" jsonb;--> statement-breakpoint
ALTER TABLE "kublai_job" ADD COLUMN "supplierDefaults" jsonb;--> statement-breakpoint
ALTER TABLE "kublai_order_item" ADD COLUMN "returnedQuantity" numeric(12, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "kublai_order_item" ADD COLUMN "creditedQuantity" numeric(12, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD COLUMN "supplierVersion" jsonb;--> statement-breakpoint
ALTER TABLE "kublai_diagnostic_count" ADD CONSTRAINT "kublai_diagnostic_count_organization_id_kublai_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_sort_preference" ADD CONSTRAINT "kublai_material_sort_preference_organization_id_kublai_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_packing_slip_review_history" ADD CONSTRAINT "kublai_packing_slip_review_history_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagnostic_count_day_idx" ON "kublai_diagnostic_count" USING btree ("day");--> statement-breakpoint
CREATE INDEX "hyperlink_reader_budget_idx" ON "kublai_hyperlink_reader_run" USING btree ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "hyperlink_reader_cache_idx" ON "kublai_hyperlink_reader_run" USING btree ("organizationId","sourceSheetId","reader","fingerprint");--> statement-breakpoint
CREATE INDEX "packing_slip_job_queue_idx" ON "kublai_packing_slip_job" USING btree ("status","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "packing_slip_history_run_kind_idx" ON "kublai_packing_slip_review_history" USING btree ("organizationId","runId","kind");--> statement-breakpoint
CREATE INDEX "packing_slip_history_job_idx" ON "kublai_packing_slip_review_history" USING btree ("organizationId","jobId","createdAt");--> statement-breakpoint
CREATE INDEX "packing_slip_terra_budget_idx" ON "kublai_packing_slip_terra_call" USING btree ("createdAt");