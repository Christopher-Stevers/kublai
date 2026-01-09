CREATE TABLE "kublai_account" (
	"userId" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"provider" varchar(255) NOT NULL,
	"providerAccountId" varchar(255) NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" varchar(255),
	"scope" varchar(255),
	"id_token" text,
	"session_state" varchar(255),
	CONSTRAINT "kublai_account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "kublai_category" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid,
	"name" varchar(255) NOT NULL,
	"parentId" uuid,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "category_org_parent_name_uniq" UNIQUE("organizationId","parentId","name")
);
--> statement-breakpoint
CREATE TABLE "kublai_job_supplier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"jobId" uuid NOT NULL,
	"supplierId" uuid NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	CONSTRAINT "job_supplier_uniq" UNIQUE("jobId","supplierId")
);
--> statement-breakpoint
CREATE TABLE "kublai_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"locationId" uuid,
	"createdByUserId" varchar(255),
	"foremanUserId" varchar(255),
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"pricingProfileId" uuid,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_location" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"address1" varchar(255),
	"address2" varchar(255),
	"city" varchar(100),
	"region" varchar(100),
	"postalCode" varchar(30),
	"country" varchar(100),
	"notes" text,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_order_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"orderId" uuid NOT NULL,
	"supplierPartId" uuid,
	"partDefinitionId" uuid NOT NULL,
	"quantity" numeric(12, 6) DEFAULT '1' NOT NULL,
	"uomId" uuid,
	"unitCostAtOrderTime" numeric(12, 4),
	"descriptionSnapshot" text,
	"supplierSkuSnapshot" varchar(255),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "kublai_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"orderNumber" varchar(100),
	"supplierId" uuid,
	"createdByUserId" varchar(255),
	"requestedFulfillmentDate" date,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"sentVia" varchar(50),
	"sentTo" varchar(255),
	"sentAt" timestamp with time zone,
	"notes" text,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_organization" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "organization_name_uniq" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "kublai_part_attribute" (
	"id" uuid PRIMARY KEY NOT NULL,
	"partDefinitionId" uuid NOT NULL,
	"key" varchar(100) NOT NULL,
	"valueNum" numeric(18, 6),
	"valueText" text,
	"unitId" uuid,
	CONSTRAINT "part_attr_part_key_uniq" UNIQUE("partDefinitionId","key")
);
--> statement-breakpoint
CREATE TABLE "kublai_part_definition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid,
	"categoryId" uuid,
	"displayName" varchar(255) NOT NULL,
	"description" text,
	"imageUrl" text,
	"partType" varchar(100),
	"material" varchar(100),
	"sizeNominal" numeric(12, 6),
	"sizeUnitId" uuid,
	"defaultUomId" uuid,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_part_synonym" (
	"id" uuid PRIMARY KEY NOT NULL,
	"partDefinitionId" uuid NOT NULL,
	"synonym" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_pricing_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(255) DEFAULT 'Default' NOT NULL,
	"defaultMarkupPercent" numeric(6, 3) DEFAULT '0' NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "pricing_profile_org_name_uniq" UNIQUE("organizationId","name")
);
--> statement-breakpoint
CREATE TABLE "kublai_quote_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quoteId" uuid NOT NULL,
	"supplierPartId" uuid,
	"partDefinitionId" uuid NOT NULL,
	"quantity" numeric(12, 6) DEFAULT '1' NOT NULL,
	"uomId" uuid,
	"unitCost" numeric(12, 4),
	"markupPercent" numeric(6, 3),
	"unitPrice" numeric(12, 4),
	"extendedPrice" numeric(14, 2),
	"descriptionSnapshot" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "kublai_quote" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"quoteNumber" varchar(100),
	"createdByUserId" varchar(255),
	"markupPercent" numeric(6, 3),
	"laborHours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"laborRate" numeric(12, 2),
	"notes" text,
	"subtotalMaterials" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_session" (
	"sessionToken" varchar(255) PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_supplier_part" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"supplierId" uuid NOT NULL,
	"partDefinitionId" uuid NOT NULL,
	"supplierSku" varchar(255),
	"supplierName" text,
	"packSize" numeric(12, 6),
	"packUomId" uuid,
	"lastKnownUnitCost" numeric(12, 4),
	"currency" varchar(10) DEFAULT 'CAD' NOT NULL,
	"isPreferred" boolean DEFAULT false NOT NULL,
	"notes" text,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "supplier_part_org_supplier_sku_uniq" UNIQUE("organizationId","supplierId","supplierSku")
);
--> statement-breakpoint
CREATE TABLE "kublai_supplier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"contactEmail" varchar(255),
	"contactPhone" varchar(50),
	"orderingNotes" text,
	"locationId" uuid,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "supplier_org_name_uniq" UNIQUE("organizationId","name")
);
--> statement-breakpoint
CREATE TABLE "kublai_unit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"displayName" varchar(64),
	CONSTRAINT "unit_code_uniq" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "kublai_user" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"email" varchar(255) NOT NULL,
	"image" varchar(255),
	"role" varchar(50) DEFAULT 'user',
	"organizationId" uuid,
	"pricingProfileId" uuid,
	"stripeCustomerId" varchar(255),
	"hasOneTimeAccess" boolean DEFAULT false,
	"stripeSubscriptionId" varchar(255),
	"subscriptionStatus" varchar(50),
	"subscriptionEndsAt" timestamp with time zone,
	"oneTimePurchaseDate" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_verification_token" (
	"identifier" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "kublai_verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "kublai_account" ADD CONSTRAINT "kublai_account_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_category" ADD CONSTRAINT "kublai_category_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_category" ADD CONSTRAINT "kublai_category_parentId_kublai_category_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."kublai_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_supplier" ADD CONSTRAINT "kublai_job_supplier_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_supplier" ADD CONSTRAINT "kublai_job_supplier_supplierId_kublai_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job" ADD CONSTRAINT "kublai_job_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job" ADD CONSTRAINT "kublai_job_locationId_kublai_location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."kublai_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job" ADD CONSTRAINT "kublai_job_createdByUserId_kublai_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job" ADD CONSTRAINT "kublai_job_foremanUserId_kublai_user_id_fk" FOREIGN KEY ("foremanUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job" ADD CONSTRAINT "kublai_job_pricingProfileId_kublai_pricing_profile_id_fk" FOREIGN KEY ("pricingProfileId") REFERENCES "public"."kublai_pricing_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_location" ADD CONSTRAINT "kublai_location_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order_item" ADD CONSTRAINT "kublai_order_item_orderId_kublai_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."kublai_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order_item" ADD CONSTRAINT "kublai_order_item_supplierPartId_kublai_supplier_part_id_fk" FOREIGN KEY ("supplierPartId") REFERENCES "public"."kublai_supplier_part"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order_item" ADD CONSTRAINT "kublai_order_item_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order_item" ADD CONSTRAINT "kublai_order_item_uomId_kublai_unit_id_fk" FOREIGN KEY ("uomId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order" ADD CONSTRAINT "kublai_order_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order" ADD CONSTRAINT "kublai_order_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order" ADD CONSTRAINT "kublai_order_supplierId_kublai_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order" ADD CONSTRAINT "kublai_order_createdByUserId_kublai_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_attribute" ADD CONSTRAINT "kublai_part_attribute_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_attribute" ADD CONSTRAINT "kublai_part_attribute_unitId_kublai_unit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_categoryId_kublai_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."kublai_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_sizeUnitId_kublai_unit_id_fk" FOREIGN KEY ("sizeUnitId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_defaultUomId_kublai_unit_id_fk" FOREIGN KEY ("defaultUomId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_synonym" ADD CONSTRAINT "kublai_part_synonym_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_pricing_profile" ADD CONSTRAINT "kublai_pricing_profile_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_quoteId_kublai_quote_id_fk" FOREIGN KEY ("quoteId") REFERENCES "public"."kublai_quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_supplierPartId_kublai_supplier_part_id_fk" FOREIGN KEY ("supplierPartId") REFERENCES "public"."kublai_supplier_part"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_uomId_kublai_unit_id_fk" FOREIGN KEY ("uomId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote" ADD CONSTRAINT "kublai_quote_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote" ADD CONSTRAINT "kublai_quote_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote" ADD CONSTRAINT "kublai_quote_createdByUserId_kublai_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_session" ADD CONSTRAINT "kublai_session_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_part" ADD CONSTRAINT "kublai_supplier_part_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_part" ADD CONSTRAINT "kublai_supplier_part_supplierId_kublai_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_part" ADD CONSTRAINT "kublai_supplier_part_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_part" ADD CONSTRAINT "kublai_supplier_part_packUomId_kublai_unit_id_fk" FOREIGN KEY ("packUomId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier" ADD CONSTRAINT "kublai_supplier_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier" ADD CONSTRAINT "kublai_supplier_locationId_kublai_location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."kublai_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_user" ADD CONSTRAINT "kublai_user_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_user" ADD CONSTRAINT "kublai_user_pricingProfileId_kublai_pricing_profile_id_fk" FOREIGN KEY ("pricingProfileId") REFERENCES "public"."kublai_pricing_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "kublai_account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "category_parent_idx" ON "kublai_category" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX "job_supplier_job_idx" ON "kublai_job_supplier" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "job_org_idx" ON "kublai_job" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "job_location_idx" ON "kublai_job" USING btree ("locationId");--> statement-breakpoint
CREATE INDEX "job_foreman_idx" ON "kublai_job" USING btree ("foremanUserId");--> statement-breakpoint
CREATE INDEX "location_org_idx" ON "kublai_location" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "order_item_order_idx" ON "kublai_order_item" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "order_item_part_idx" ON "kublai_order_item" USING btree ("partDefinitionId");--> statement-breakpoint
CREATE INDEX "order_job_idx" ON "kublai_order" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "order_supplier_idx" ON "kublai_order" USING btree ("supplierId");--> statement-breakpoint
CREATE INDEX "order_org_idx" ON "kublai_order" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "part_attr_key_num_idx" ON "kublai_part_attribute" USING btree ("key","valueNum");--> statement-breakpoint
CREATE INDEX "part_def_org_idx" ON "kublai_part_definition" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "part_def_category_idx" ON "kublai_part_definition" USING btree ("categoryId");--> statement-breakpoint
CREATE INDEX "part_def_facets_idx" ON "kublai_part_definition" USING btree ("partType","material","sizeNominal");--> statement-breakpoint
CREATE INDEX "part_synonym_part_idx" ON "kublai_part_synonym" USING btree ("partDefinitionId");--> statement-breakpoint
CREATE INDEX "pricing_profile_org_idx" ON "kublai_pricing_profile" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "quote_item_quote_idx" ON "kublai_quote_item" USING btree ("quoteId");--> statement-breakpoint
CREATE INDEX "quote_item_part_idx" ON "kublai_quote_item" USING btree ("partDefinitionId");--> statement-breakpoint
CREATE INDEX "quote_job_idx" ON "kublai_quote" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "kublai_session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "supplier_part_supplier_idx" ON "kublai_supplier_part" USING btree ("supplierId");--> statement-breakpoint
CREATE INDEX "supplier_part_part_idx" ON "kublai_supplier_part" USING btree ("partDefinitionId");--> statement-breakpoint
CREATE INDEX "supplier_part_preferred_idx" ON "kublai_supplier_part" USING btree ("organizationId","partDefinitionId","isPreferred");--> statement-breakpoint
CREATE INDEX "supplier_org_idx" ON "kublai_supplier" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "supplier_location_idx" ON "kublai_supplier" USING btree ("locationId");