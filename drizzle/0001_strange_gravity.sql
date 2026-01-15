CREATE TABLE "kublai_material_list" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"quoteId" uuid,
	"createdByUserId" varchar(255),
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_material" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "material_org_name_uniq" UNIQUE("organizationId","name")
);
--> statement-breakpoint
CREATE TABLE "kublai_part_type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "part_type_org_name_uniq" UNIQUE("organizationId","name")
);
--> statement-breakpoint
CREATE TABLE "kublai_size" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"nominal" numeric(12, 6) NOT NULL,
	"unitId" uuid NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "size_org_nominal_unit_uniq" UNIQUE("organizationId","nominal","unitId")
);
--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ALTER COLUMN "partDefinitionId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "kublai_quote" ALTER COLUMN "jobId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD COLUMN "oneOffDisplayName" varchar(255);--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD COLUMN "oneOffDescription" text;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD COLUMN "oneOffMaterial" varchar(100);--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD COLUMN "oneOffPartType" varchar(100);--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD COLUMN "oneOffSizeNominal" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD COLUMN "oneOffSizeUnitId" uuid;--> statement-breakpoint
ALTER TABLE "kublai_quote" ADD COLUMN "materialListId" uuid;--> statement-breakpoint
ALTER TABLE "kublai_user" ADD COLUMN "currentJobId" uuid;--> statement-breakpoint
ALTER TABLE "kublai_material_list" ADD CONSTRAINT "kublai_material_list_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list" ADD CONSTRAINT "kublai_material_list_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list" ADD CONSTRAINT "kublai_material_list_quoteId_kublai_quote_id_fk" FOREIGN KEY ("quoteId") REFERENCES "public"."kublai_quote"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list" ADD CONSTRAINT "kublai_material_list_createdByUserId_kublai_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material" ADD CONSTRAINT "kublai_material_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_type" ADD CONSTRAINT "kublai_part_type_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_size" ADD CONSTRAINT "kublai_size_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_size" ADD CONSTRAINT "kublai_size_unitId_kublai_unit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."kublai_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_list_job_idx" ON "kublai_material_list" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "material_list_org_idx" ON "kublai_material_list" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "material_list_quote_idx" ON "kublai_material_list" USING btree ("quoteId");--> statement-breakpoint
CREATE INDEX "material_org_idx" ON "kublai_material" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "part_type_org_idx" ON "kublai_part_type" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "size_org_idx" ON "kublai_size" USING btree ("organizationId");--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_oneOffSizeUnitId_kublai_unit_id_fk" FOREIGN KEY ("oneOffSizeUnitId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote" ADD CONSTRAINT "kublai_quote_materialListId_kublai_material_list_id_fk" FOREIGN KEY ("materialListId") REFERENCES "public"."kublai_material_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_user" ADD CONSTRAINT "kublai_user_currentJobId_kublai_job_id_fk" FOREIGN KEY ("currentJobId") REFERENCES "public"."kublai_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_material_list_idx" ON "kublai_quote" USING btree ("materialListId");