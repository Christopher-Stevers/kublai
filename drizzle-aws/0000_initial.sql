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
CREATE TABLE "kublai_asset_count_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"countId" uuid NOT NULL,
	"assetId" uuid,
	"partDefinitionId" uuid NOT NULL,
	"expectedQuantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"countedQuantity" numeric(12, 3),
	CONSTRAINT "asset_count_line_asset_uniq" UNIQUE("countId","assetId")
);
--> statement-breakpoint
CREATE TABLE "kublai_asset_count" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"holderType" varchar(20) NOT NULL,
	"holderId" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"notes" text,
	"startedByUserId" varchar(255),
	"completedByUserId" varchar(255),
	"createdAt" timestamp with time zone NOT NULL,
	"completedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kublai_asset_location" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"notes" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_asset_movement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"assetId" uuid,
	"partDefinitionId" uuid NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"fromType" varchar(20),
	"fromId" varchar(255),
	"toType" varchar(20),
	"toId" varchar(255),
	"statusFrom" varchar(20),
	"statusTo" varchar(20),
	"orderId" uuid,
	"countId" uuid,
	"note" text,
	"userId" varchar(255),
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_asset_stock" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"partDefinitionId" uuid NOT NULL,
	"holderType" varchar(20) NOT NULL,
	"holderId" varchar(255) NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_stock_holding_uniq" UNIQUE("organizationId","partDefinitionId","holderType","holderId")
);
--> statement-breakpoint
CREATE TABLE "kublai_asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"partDefinitionId" uuid NOT NULL,
	"assetTag" varchar(40) NOT NULL,
	"serialNumber" varchar(120),
	"status" varchar(20) DEFAULT 'available' NOT NULL,
	"holderType" varchar(20) NOT NULL,
	"holderId" varchar(255) NOT NULL,
	"notes" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_org_tag_uniq" UNIQUE("organizationId","assetTag")
);
--> statement-breakpoint
CREATE TABLE "kublai_catalog" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"kind" varchar(20) DEFAULT 'materials' NOT NULL,
	CONSTRAINT "catalog_org_name_uniq" UNIQUE("organizationId","name")
);
--> statement-breakpoint
CREATE TABLE "kublai_category" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "category_org_name_uniq" UNIQUE("organizationId","name")
);
--> statement-breakpoint
CREATE TABLE "kublai_conversation_attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversationId" uuid NOT NULL,
	"uploadedById" varchar(255),
	"messageId" uuid,
	"name" varchar(200) NOT NULL,
	"mimeType" varchar(80) NOT NULL,
	"size" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_conversation_member" (
	"conversationId" uuid NOT NULL,
	"userId" varchar(255) NOT NULL,
	"lastReadSequence" bigint DEFAULT 0 NOT NULL,
	"joinedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kublai_conversation_member_conversationId_userId_pk" PRIMARY KEY("conversationId","userId")
);
--> statement-breakpoint
CREATE TABLE "kublai_conversation_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"conversationId" uuid NOT NULL,
	"authorId" varchar(255),
	"clientId" uuid NOT NULL,
	"requestHash" varchar(64) NOT NULL,
	"body" text NOT NULL,
	"source" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"editedAt" timestamp with time zone,
	"editClientId" uuid,
	"editRequestHash" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	CONSTRAINT "kublai_conversation_message_sequence_unique" UNIQUE("sequence")
);
--> statement-breakpoint
CREATE TABLE "kublai_conversation_push_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizationId" uuid NOT NULL,
	"conversationId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"subscriptionId" uuid NOT NULL,
	"recipientId" varchar(255) NOT NULL,
	"senderId" varchar(255) NOT NULL,
	"sequence" bigint NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"availableAt" timestamp with time zone DEFAULT now() NOT NULL,
	"leaseToken" uuid,
	"leasedUntil" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"outcome" varchar(32),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"kind" varchar(8) NOT NULL,
	"name" varchar(120) DEFAULT '' NOT NULL,
	"directKey" varchar(64),
	"createdById" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_drawing_legend_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"setId" uuid NOT NULL,
	"sourceSheetId" uuid NOT NULL,
	"sourceKey" varchar(100) NOT NULL,
	"data" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"reviewedBy" varchar(255) NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_employee_simulation_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessionId" uuid NOT NULL,
	"action" varchar(512) NOT NULL,
	"outcome" varchar(32) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_employee_simulation_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"organizationId" uuid NOT NULL,
	"actorId" varchar(255) NOT NULL,
	"employeeId" varchar(255) NOT NULL,
	"actorName" varchar(255) NOT NULL,
	"employeeName" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"endedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kublai_entity_sync_mutation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"userId" varchar(255),
	"clientMutationId" varchar(255) NOT NULL,
	"mutationType" varchar(80) NOT NULL,
	"entityType" varchar(80) NOT NULL,
	"clientEntityId" varchar(255) NOT NULL,
	"serverEntityId" uuid,
	"status" varchar(40) DEFAULT 'applied' NOT NULL,
	"error" text,
	"payload" jsonb,
	"appliedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "entity_sync_mutation_client_uniq" UNIQUE("organizationId","clientMutationId")
);
--> statement-breakpoint
CREATE TABLE "kublai_estimate_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimateId" uuid NOT NULL,
	"organizationId" uuid NOT NULL,
	"revision" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(20) NOT NULL,
	"document" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"action" varchar(80) NOT NULL,
	"actorId" varchar(255) NOT NULL,
	"actorName" varchar(255) NOT NULL,
	"effectiveUserId" varchar(255) NOT NULL,
	"effectiveUserName" varchar(255) NOT NULL,
	"simulationId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estimate_audit_revision_positive" CHECK ("kublai_estimate_revision"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "kublai_estimate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"document" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"createdByUserId" varchar(255) NOT NULL,
	"createdByName" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estimate_revision_positive" CHECK ("kublai_estimate"."revision" > 0),
	CONSTRAINT "estimate_status_valid" CHECK ("kublai_estimate"."status" in ('draft','in_review','approved','sent','won','lost','archived'))
);
--> statement-breakpoint
CREATE TABLE "kublai_estimating_pricing" (
	"organizationId" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assemblies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estimating_pricing_revision_valid" CHECK ("kublai_estimating_pricing"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "kublai_estimating_pricing_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizationId" uuid NOT NULL,
	"revision" integer NOT NULL,
	"rows" jsonb NOT NULL,
	"assemblies" jsonb NOT NULL,
	"actorId" varchar(255) NOT NULL,
	"actorName" varchar(255) NOT NULL,
	"effectiveUserId" varchar(255) NOT NULL,
	"effectiveUserName" varchar(255) NOT NULL,
	"simulationId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estimating_pricing_audit_revision_positive" CHECK ("kublai_estimating_pricing_revision"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "kublai_job_chat_attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"jobId" uuid NOT NULL,
	"uploadedById" varchar(255),
	"messageId" uuid,
	"name" varchar(255) NOT NULL,
	"mimeType" varchar(80) NOT NULL,
	"size" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_job_chat_event" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"jobId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_job_chat_member" (
	"jobId" uuid NOT NULL,
	"userId" varchar(255) NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"lastReadSequence" bigint DEFAULT 0 NOT NULL,
	"joinedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kublai_job_chat_member_jobId_userId_pk" PRIMARY KEY("jobId","userId")
);
--> statement-breakpoint
CREATE TABLE "kublai_job_chat_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"jobId" uuid NOT NULL,
	"authorId" varchar(255),
	"clientId" uuid NOT NULL,
	"requestHash" varchar(64) NOT NULL,
	"body" text NOT NULL,
	"replyToId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"editedAt" timestamp with time zone,
	"deletedAt" timestamp with time zone,
	CONSTRAINT "kublai_job_chat_message_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "job_chat_message_retry_uniq" UNIQUE("jobId","authorId","clientId")
);
--> statement-breakpoint
CREATE TABLE "kublai_job_document_workspace" (
	"jobId" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"state" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_job_draw_item" (
	"drawId" uuid NOT NULL,
	"lineId" uuid NOT NULL,
	"completedToDate" numeric(14, 2) DEFAULT '0' NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "kublai_job_draw_item_drawId_lineId_pk" PRIMARY KEY("drawId","lineId")
);
--> statement-breakpoint
CREATE TABLE "kublai_job_draw_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"itemNumber" varchar(50),
	"description" varchar(500) NOT NULL,
	"scheduledValue" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_job_drawing_set" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"documentVersionId" uuid,
	"name" varchar(255) NOT NULL,
	"createdByUserId" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_job_drawing_sheet" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"setId" uuid NOT NULL,
	"documentVersionId" uuid,
	"name" varchar(255) NOT NULL,
	"imageUrl" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"sourceFilename" varchar(255),
	"uploadedByUserId" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_job_draw" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"drawNumber" integer NOT NULL,
	"periodEnd" date,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"retainagePercent" numeric(6, 3) DEFAULT '10' NOT NULL,
	"notes" text,
	"submittedAt" timestamp with time zone,
	"paidAt" timestamp with time zone,
	"createdByUserId" varchar(255),
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "job_draw_job_number_uniq" UNIQUE("jobId","drawNumber")
);
--> statement-breakpoint
CREATE TABLE "kublai_job_floor_plan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"originalFilename" varchar(255) NOT NULL,
	"storageKey" varchar(512) NOT NULL,
	"status" varchar(50) DEFAULT 'processing' NOT NULL,
	"pageCount" integer DEFAULT 0 NOT NULL,
	"error" text,
	"uploadedByUserId" varchar(255),
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "job_floor_plan_job_uniq" UNIQUE("jobId")
);
--> statement-breakpoint
CREATE TABLE "kublai_job_floor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"floorPlanId" uuid NOT NULL,
	"pageNumber" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"imageUrl" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"status" varchar(50) DEFAULT 'detected' NOT NULL,
	"confirmedAt" timestamp with time zone,
	"completenessReviewedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "job_floor_plan_page_uniq" UNIQUE("floorPlanId","pageNumber")
);
--> statement-breakpoint
CREATE TABLE "kublai_job_order_approval" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"materialListId" uuid NOT NULL,
	"supplierId" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"requestNote" text NOT NULL,
	"reviewNote" text,
	"requestedBy" varchar(255),
	"requestedByActor" varchar(255),
	"reviewedBy" varchar(255),
	"reviewedByActor" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewedAt" timestamp with time zone,
	"usedAt" timestamp with time zone,
	CONSTRAINT "job_order_approval_content_uniq" UNIQUE("organizationId","materialListId","supplierId","fingerprint"),
	CONSTRAINT "job_order_approval_status_check" CHECK ("kublai_job_order_approval"."status" in ('pending','approved','rejected','superseded'))
);
--> statement-breakpoint
CREATE TABLE "kublai_job_price_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"priceListId" uuid NOT NULL,
	"supplierPriceBookEntryId" uuid,
	"supplierPartId" uuid NOT NULL,
	"sourceDescription" text,
	"unitCost" numeric(12, 4),
	"priceStatus" varchar(20) DEFAULT 'none' NOT NULL,
	"priceBasis" varchar(100) DEFAULT 'each' NOT NULL,
	"priceSource" text,
	"active" boolean DEFAULT true NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_price_entry_listing_uniq" UNIQUE("priceListId","supplierPartId"),
	CONSTRAINT "job_price_entry_cost_check" CHECK ("kublai_job_price_entry"."unitCost" is null or "kublai_job_price_entry"."unitCost" >= 0),
	CONSTRAINT "job_price_entry_status_check" CHECK ("kublai_job_price_entry"."priceStatus" in ('none','estimated','confirmed'))
);
--> statement-breakpoint
CREATE TABLE "kublai_job_price_list" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"currency" varchar(10) DEFAULT 'CAD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"requireApproval" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_price_list_job_uniq" UNIQUE("jobId")
);
--> statement-breakpoint
CREATE TABLE "kublai_job_pricing_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"action" varchar(60) NOT NULL,
	"detail" jsonb NOT NULL,
	"userId" varchar(255),
	"actorUserId" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_job_room" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"floorId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"notesRevision" integer DEFAULT 0 NOT NULL,
	"source" varchar(50) DEFAULT 'auto' NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"reviewStatus" varchar(20) DEFAULT 'pending' NOT NULL,
	"detection" jsonb,
	"shape" jsonb NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_job_supplier_price_book" (
	"id" uuid PRIMARY KEY NOT NULL,
	"jobId" uuid NOT NULL,
	"supplierId" uuid NOT NULL,
	"bookId" uuid NOT NULL,
	CONSTRAINT "job_supplier_price_book_uniq" UNIQUE("jobId","supplierId")
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
CREATE TABLE "kublai_job_system_assessment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"requestedBy" varchar(255) NOT NULL,
	"status" varchar(20) NOT NULL,
	"data" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_system_assessment_status_check" CHECK ("kublai_job_system_assessment"."status" in ('processing', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "kublai_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"locationId" uuid,
	"createdByUserId" varchar(255),
	"foremanUserId" varchar(255),
	"foremanName" varchar(255),
	"poNumber" varchar(100),
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"pricingProfileId" uuid,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
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
CREATE TABLE "kublai_material_list_sync_mutation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"userId" varchar(255),
	"materialListId" uuid NOT NULL,
	"clientMutationId" varchar(255) NOT NULL,
	"mutationType" varchar(80) NOT NULL,
	"serverItemId" uuid,
	"clientItemId" varchar(255),
	"status" varchar(40) DEFAULT 'applied' NOT NULL,
	"error" text,
	"payload" jsonb,
	"appliedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "material_list_sync_mutation_client_uniq" UNIQUE("organizationId","clientMutationId")
);
--> statement-breakpoint
CREATE TABLE "kublai_material_list_sync_tombstone" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"materialListId" uuid NOT NULL,
	"entityType" varchar(40) NOT NULL,
	"entityId" varchar(255) NOT NULL,
	"deletedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "material_list_sync_tombstone_entity_uniq" UNIQUE("organizationId","entityType","entityId")
);
--> statement-breakpoint
CREATE TABLE "kublai_material_list" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"roomId" uuid,
	"name" varchar(255) NOT NULL,
	"quoteId" uuid,
	"createdByUserId" varchar(255),
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"kind" varchar(20) DEFAULT 'materials' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_material_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizationId" uuid NOT NULL,
	"materialListId" uuid NOT NULL,
	"senderId" varchar(255) NOT NULL,
	"recipientId" varchar(255) NOT NULL,
	"eventKey" text NOT NULL,
	"action" varchar(16) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"readAt" timestamp with time zone,
	CONSTRAINT "material_notification_event_recipient_uniq" UNIQUE("organizationId","eventKey","recipientId"),
	CONSTRAINT "material_notification_action_check" CHECK ("kublai_material_notification"."action" in ('added','edited'))
);
--> statement-breakpoint
CREATE TABLE "kublai_material_prefab_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"prefabId" uuid NOT NULL,
	"partDefinitionId" uuid NOT NULL,
	"supplierPartId" uuid,
	"quantity" numeric(12, 6) DEFAULT '1' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_prefab_item_part_uniq" UNIQUE("prefabId","partDefinitionId")
);
--> statement-breakpoint
CREATE TABLE "kublai_material_prefab" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"kind" varchar(16) DEFAULT 'materials' NOT NULL,
	"name" varchar(255) NOT NULL,
	"createdByUserId" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_material_push_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notificationId" uuid NOT NULL,
	"subscriptionId" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"availableAt" timestamp with time zone DEFAULT now() NOT NULL,
	"leaseToken" uuid,
	"leasedUntil" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"outcome" varchar(32),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_push_notification_device_uniq" UNIQUE("notificationId","subscriptionId")
);
--> statement-breakpoint
CREATE TABLE "kublai_material" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"groupPath" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "material_org_name_uniq" UNIQUE("organizationId","name")
);
--> statement-breakpoint
CREATE TABLE "kublai_order_delivery_preferences" (
	"userId" varchar(255) PRIMARY KEY NOT NULL,
	"calendar" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_order_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"orderId" uuid NOT NULL,
	"roomId" uuid,
	"supplierPartId" uuid,
	"partDefinitionId" uuid NOT NULL,
	"quantity" numeric(12, 6) DEFAULT '1' NOT NULL,
	"position" integer,
	"requestedQuantity" numeric(12, 6),
	"orderMultipleSnapshot" numeric(12, 6),
	"receivedQuantity" numeric(12, 6) DEFAULT '0' NOT NULL,
	"verificationStatus" varchar(50) DEFAULT 'pending' NOT NULL,
	"uomId" uuid,
	"unitCostAtOrderTime" numeric(12, 4),
	"priceStatusSnapshot" varchar(20),
	"priceBookNameSnapshot" varchar(255),
	"descriptionSnapshot" text,
	"supplierSkuSnapshot" varchar(255),
	"notes" text,
	"assetId" uuid,
	"fulfilledQuantity" numeric(12, 6)
);
--> statement-breakpoint
CREATE TABLE "kublai_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"materialListId" uuid,
	"orderNumber" varchar(100),
	"supplierId" uuid,
	"createdByUserId" varchar(255),
	"requestedFulfillmentDate" date,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"sentVia" varchar(50),
	"sentTo" varchar(255),
	"sentAt" timestamp with time zone,
	"notes" text,
	"createdAt" timestamp with time zone NOT NULL,
	"kind" varchar(20) DEFAULT 'materials' NOT NULL,
	"fulfillmentStatus" varchar(20),
	"fulfilledAt" timestamp with time zone,
	CONSTRAINT "order_org_job_number_uniq" UNIQUE("organizationId","jobId","orderNumber")
);
--> statement-breakpoint
CREATE TABLE "kublai_organization_department_lead" (
	"organizationId" uuid NOT NULL,
	"departmentId" uuid NOT NULL,
	"userId" varchar(255) NOT NULL,
	CONSTRAINT "kublai_organization_department_lead_departmentId_userId_pk" PRIMARY KEY("departmentId","userId")
);
--> statement-breakpoint
CREATE TABLE "kublai_organization_department" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "organization_department_org_id_uniq" UNIQUE("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "kublai_organization_invite" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"token" varchar(128) NOT NULL,
	"defaultLandingPage" jsonb,
	"name" varchar(255),
	"role" varchar(50) DEFAULT 'user' NOT NULL,
	"permissionConfig" jsonb,
	"createdByUserId" varchar(255),
	"expiresAt" timestamp with time zone NOT NULL,
	"revokedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "organization_invite_token_uniq" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "kublai_organization_permission_preset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"permissionConfig" jsonb NOT NULL,
	"memberDetails" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_organization_reporting_line" (
	"organizationId" uuid NOT NULL,
	"userId" varchar(255) NOT NULL,
	"reportsToUserId" varchar(255) NOT NULL,
	CONSTRAINT "kublai_organization_reporting_line_organizationId_userId_reportsToUserId_pk" PRIMARY KEY("organizationId","userId","reportsToUserId"),
	CONSTRAINT "organization_reporting_line_not_self" CHECK ("kublai_organization_reporting_line"."userId" <> "kublai_organization_reporting_line"."reportsToUserId")
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
	"organizationId" uuid NOT NULL,
	"catalogId" uuid NOT NULL,
	"categoryId" uuid,
	"displayName" varchar(255) NOT NULL,
	"piecesPerPack" integer,
	"bulkUnit" varchar(32),
	"individualUnit" varchar(32),
	"description" text,
	"imageUrl" text,
	"imageAssetId" uuid,
	"sizeLabel" varchar(100),
	"materialId" uuid,
	"sizeId" uuid,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"assetTracking" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "kublai_part_synonym" (
	"id" uuid PRIMARY KEY NOT NULL,
	"partDefinitionId" uuid NOT NULL,
	"synonym" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_photo_asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"storageKey" text NOT NULL,
	"url" text NOT NULL,
	"originalFilename" varchar(255),
	"contentType" varchar(100) DEFAULT 'image/webp' NOT NULL,
	"byteSize" integer,
	"checksum" varchar(64),
	"sourceUrl" text,
	"notes" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "photo_asset_org_url_uniq" UNIQUE("organizationId","url")
);
--> statement-breakpoint
CREATE TABLE "kublai_pipe_system_spec" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid,
	"system" varchar(40) NOT NULL,
	"data" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updatedBy" varchar(255) NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "kublai_quantity_unit" (
	"organizationId" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"name" varchar(32) NOT NULL,
	CONSTRAINT "kublai_quantity_unit_organizationId_kind_name_pk" PRIMARY KEY("organizationId","kind","name"),
	CONSTRAINT "quantity_unit_kind" CHECK ("kublai_quantity_unit"."kind" IN ('bulk', 'individual')),
	CONSTRAINT "quantity_unit_name" CHECK (length(trim("kublai_quantity_unit"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "kublai_quote_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quoteId" uuid NOT NULL,
	"sentOrderItemId" uuid,
	"roomId" uuid,
	"supplierPartId" uuid,
	"supplierId" uuid,
	"partDefinitionId" uuid,
	"oneOffDisplayName" varchar(255),
	"oneOffDescription" text,
	"oneOffMaterial" varchar(100),
	"oneOffSizeNominal" numeric(12, 6),
	"oneOffSizeUnitId" uuid,
	"quantity" numeric(12, 6) DEFAULT '1' NOT NULL,
	"uomId" uuid,
	"unitCost" numeric(12, 4),
	"markupPercent" numeric(6, 3),
	"unitPrice" numeric(12, 4),
	"extendedPrice" numeric(14, 2),
	"descriptionSnapshot" text,
	"notes" text,
	"addedByUserId" varchar(255),
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_quote" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"materialListId" uuid,
	"jobId" uuid,
	"quoteNumber" varchar(100),
	"generatedAt" timestamp with time zone,
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
CREATE TABLE "kublai_replicache_client_group" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"userId" varchar(255),
	"schemaVersion" varchar(80) NOT NULL,
	"cvrVersion" integer DEFAULT 0 NOT NULL,
	"lastPullOrder" bigint DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_replicache_client" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"clientGroupId" varchar(255) NOT NULL,
	"organizationId" uuid NOT NULL,
	"userId" varchar(255),
	"lastMutationId" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_room_detection_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"floorId" uuid NOT NULL,
	"roomId" uuid NOT NULL,
	"userId" varchar(255),
	"decision" varchar(20) NOT NULL,
	"drawingKey" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"proposalShape" jsonb NOT NULL,
	"correctedShape" jsonb,
	"detection" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kublai_room_detection_feedback_decision_check" CHECK ("kublai_room_detection_feedback"."decision" in ('approved', 'rejected', 'pending', 'corrected', 'added', 'renamed', 'cleared'))
);
--> statement-breakpoint
CREATE TABLE "kublai_room_detection_job" (
	"floorId" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"runId" uuid DEFAULT gen_random_uuid() NOT NULL,
	"workerBootId" text,
	"workerStartTicks" text,
	"status" varchar(20) NOT NULL,
	"startedAt" timestamp with time zone NOT NULL,
	"heartbeatAt" timestamp with time zone NOT NULL,
	"finishedAt" timestamp with time zone,
	"workerPid" integer,
	"error" text,
	"result" jsonb,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_session" (
	"sessionToken" varchar(255) PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL
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
CREATE TABLE "kublai_super_scale_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"organizationId" uuid NOT NULL,
	"sheetId" uuid NOT NULL,
	"first" text DEFAULT '' NOT NULL,
	"second" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" text DEFAULT 'Queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"output" jsonb,
	"error" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kublai_supplier_email_preference" (
	"userId" varchar(255) NOT NULL,
	"supplierId" uuid NOT NULL,
	"organizationId" uuid NOT NULL,
	"includeSupplierSku" boolean DEFAULT false NOT NULL,
	CONSTRAINT "kublai_supplier_email_preference_userId_supplierId_pk" PRIMARY KEY("userId","supplierId")
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
CREATE TABLE "kublai_supplier_price_book_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bookId" uuid NOT NULL,
	"supplierPartId" uuid NOT NULL,
	"unitCost" numeric(12, 4),
	"priceStatus" varchar(20) DEFAULT 'none' NOT NULL,
	"priceBasis" varchar(100) DEFAULT 'each' NOT NULL,
	"priceSource" text,
	"sourceDescription" text,
	CONSTRAINT "supplier_price_book_entry_uniq" UNIQUE("bookId","supplierPartId")
);
--> statement-breakpoint
CREATE TABLE "kublai_supplier_price_book" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"supplierId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_price_book_name_uniq" UNIQUE("supplierId","name")
);
--> statement-breakpoint
CREATE TABLE "kublai_supplier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"contactName" varchar(255),
	"contactEmail" varchar(255),
	"contactPhone" varchar(50),
	"contacts" jsonb,
	"orderingNotes" text,
	"preferJobPricing" boolean DEFAULT true NOT NULL,
	"locationId" uuid,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"kind" varchar(20) DEFAULT 'external' NOT NULL,
	CONSTRAINT "supplier_org_name_uniq" UNIQUE("organizationId","name")
);
--> statement-breakpoint
CREATE TABLE "kublai_sync_revision" (
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "kublai_sync_revision_kind_scope_pk" PRIMARY KEY("kind","scope")
);
--> statement-breakpoint
CREATE TABLE "kublai_time_clock" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"userId" varchar(255) NOT NULL,
	"jobId" uuid,
	"jobName" varchar(255) DEFAULT 'General' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"timezone" varchar(100) NOT NULL,
	"periods" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_clock_user_unique" UNIQUE("organizationId","userId")
);
--> statement-breakpoint
CREATE TABLE "kublai_time_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sheetId" uuid NOT NULL,
	"date" date NOT NULL,
	"jobId" uuid,
	"jobName" varchar(255) DEFAULT 'General' NOT NULL,
	"category" varchar(20) DEFAULT 'work' NOT NULL,
	"minutes" integer NOT NULL,
	"breakMinutes" integer DEFAULT 0 NOT NULL,
	"costCode" varchar(100) DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source" varchar(10) DEFAULT 'manual' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_time_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"sheetId" uuid,
	"userId" varchar(255) NOT NULL,
	"actorId" varchar(255) NOT NULL,
	"actorName" varchar(255) NOT NULL,
	"action" varchar(50) NOT NULL,
	"data" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_time_settings" (
	"organizationId" uuid PRIMARY KEY NOT NULL,
	"cadence" varchar(10) DEFAULT 'weekly' NOT NULL,
	"weekStartsOn" integer DEFAULT 1 NOT NULL,
	"timezone" varchar(100) DEFAULT 'America/Toronto' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_time_sheet" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"userId" varchar(255) NOT NULL,
	"startDate" date NOT NULL,
	"endDate" date NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"reviewNote" text DEFAULT '' NOT NULL,
	"submittedAt" timestamp with time zone,
	"reviewedAt" timestamp with time zone,
	"reviewerId" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_sheet_period_unique" UNIQUE("organizationId","userId","startDate")
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
	"permissionConfig" jsonb,
	"defaultLandingPage" jsonb,
	"permissionPresetId" uuid,
	"organizationAccessStatus" varchar(50) DEFAULT 'approved',
	"department" varchar(100),
	"organizationId" uuid,
	"pricingProfileId" uuid,
	"stripeCustomerId" varchar(255),
	"hasOneTimeAccess" boolean DEFAULT false,
	"stripeSubscriptionId" varchar(255),
	"subscriptionStatus" varchar(50),
	"subscriptionEndsAt" timestamp with time zone,
	"oneTimePurchaseDate" timestamp with time zone,
	"tutorialCompletedAt" timestamp with time zone,
	"tutorialOutcome" varchar(20),
	"currentJobId" uuid,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "user_organization_id_uniq" UNIQUE("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "kublai_verification_token" (
	"identifier" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "kublai_verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "kublai_chat_push_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"subscriptionId" uuid NOT NULL,
	"recipientId" varchar(255) NOT NULL,
	"senderId" varchar(255) NOT NULL,
	"sequence" bigint NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"availableAt" timestamp with time zone DEFAULT now() NOT NULL,
	"leaseToken" uuid,
	"leasedUntil" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"outcome" varchar(32),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_chat_push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" varchar(255) NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"revokeTokenHash" varchar(64) NOT NULL,
	"deviceType" varchar(16) DEFAULT 'unknown' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_app_device_observation" (
	"userId" varchar(255) NOT NULL,
	"deviceId" uuid NOT NULL,
	"deviceType" varchar(16) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"mode" varchar(16) NOT NULL,
	"installButtonVisible" boolean NOT NULL,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"installedAppLastSeenAt" timestamp with time zone,
	CONSTRAINT "kublai_app_device_observation_userId_deviceId_pk" PRIMARY KEY("userId","deviceId")
);
--> statement-breakpoint
CREATE TABLE "kublai_bim_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"actorId" varchar(255) NOT NULL,
	"action" varchar(100) NOT NULL,
	"entityId" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_bim_design" (
	"modelId" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"revision" integer NOT NULL,
	"data" jsonb NOT NULL,
	"updatedBy" varchar(255) NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_bim_issue" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"revision" integer NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_bim_model" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"seriesId" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"sourceSha" varchar(64) NOT NULL,
	"viewSha" varchar(64),
	"conversionRequestedBy" varchar(255),
	"conversionCheckedAt" timestamp with time zone,
	"conversionUrn" text,
	"conversionLease" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_bim_view" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organizationId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "kublai_account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "asset_count_line_count_idx" ON "kublai_asset_count_line" USING btree ("countId");--> statement-breakpoint
CREATE INDEX "asset_count_org_idx" ON "kublai_asset_count" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX "asset_location_org_idx" ON "kublai_asset_location" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "asset_movement_org_created_idx" ON "kublai_asset_movement" USING btree ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "asset_movement_asset_idx" ON "kublai_asset_movement" USING btree ("assetId");--> statement-breakpoint
CREATE INDEX "asset_stock_holder_idx" ON "kublai_asset_stock" USING btree ("organizationId","holderType","holderId");--> statement-breakpoint
CREATE INDEX "asset_org_holder_idx" ON "kublai_asset" USING btree ("organizationId","holderType","holderId");--> statement-breakpoint
CREATE INDEX "asset_part_idx" ON "kublai_asset" USING btree ("partDefinitionId");--> statement-breakpoint
CREATE INDEX "catalog_org_idx" ON "kublai_catalog" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "conversation_attachment_message_idx" ON "kublai_conversation_attachment" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "conversation_attachment_uploader_idx" ON "kublai_conversation_attachment" USING btree ("uploadedById","createdAt");--> statement-breakpoint
CREATE INDEX "conversation_member_user_idx" ON "kublai_conversation_member" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_retry_unique" ON "kublai_conversation_message" USING btree ("conversationId","authorId","clientId");--> statement-breakpoint
CREATE INDEX "conversation_message_page_idx" ON "kublai_conversation_message" USING btree ("conversationId","sequence");--> statement-breakpoint
CREATE INDEX "conversation_message_author_time_idx" ON "kublai_conversation_message" USING btree ("authorId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_push_message_device_uniq" ON "kublai_conversation_push_outbox" USING btree ("messageId","subscriptionId");--> statement-breakpoint
CREATE INDEX "conversation_push_ready_idx" ON "kublai_conversation_push_outbox" USING btree ("completedAt","availableAt","leasedUntil");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_direct_key_unique" ON "kublai_conversation" USING btree ("organizationId","directKey");--> statement-breakpoint
CREATE INDEX "conversation_org_idx" ON "kublai_conversation" USING btree ("organizationId","updatedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "drawing_legend_source_idx" ON "kublai_drawing_legend_item" USING btree ("setId","sourceSheetId","sourceKey");--> statement-breakpoint
CREATE INDEX "drawing_legend_set_idx" ON "kublai_drawing_legend_item" USING btree ("organizationId","setId");--> statement-breakpoint
CREATE INDEX "simulation_audit_session_created_idx" ON "kublai_employee_simulation_audit" USING btree ("sessionId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_token_hash_unique" ON "kublai_employee_simulation_session" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "simulation_actor_created_idx" ON "kublai_employee_simulation_session" USING btree ("actorId","createdAt");--> statement-breakpoint
CREATE INDEX "entity_sync_mutation_entity_idx" ON "kublai_entity_sync_mutation" USING btree ("organizationId","entityType","serverEntityId");--> statement-breakpoint
CREATE UNIQUE INDEX "estimate_revision_unique" ON "kublai_estimate_revision" USING btree ("estimateId","revision");--> statement-breakpoint
CREATE INDEX "estimate_revision_org_idx" ON "kublai_estimate_revision" USING btree ("organizationId","estimateId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "estimate_id_org_unique" ON "kublai_estimate" USING btree ("id","organizationId");--> statement-breakpoint
CREATE INDEX "estimate_org_updated_idx" ON "kublai_estimate" USING btree ("organizationId","updatedAt","id");--> statement-breakpoint
CREATE INDEX "estimate_job_status_idx" ON "kublai_estimate" USING btree ("organizationId","jobId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "estimating_pricing_revision_unique" ON "kublai_estimating_pricing_revision" USING btree ("organizationId","revision");--> statement-breakpoint
CREATE INDEX "job_chat_attachment_message_idx" ON "kublai_job_chat_attachment" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "job_chat_attachment_pending_idx" ON "kublai_job_chat_attachment" USING btree ("uploadedById","createdAt");--> statement-breakpoint
CREATE INDEX "job_chat_event_page_idx" ON "kublai_job_chat_event" USING btree ("jobId","sequence");--> statement-breakpoint
CREATE INDEX "job_chat_member_user_idx" ON "kublai_job_chat_member" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "job_chat_message_page_idx" ON "kublai_job_chat_message" USING btree ("jobId","sequence");--> statement-breakpoint
CREATE INDEX "job_chat_message_author_time_idx" ON "kublai_job_chat_message" USING btree ("authorId","createdAt");--> statement-breakpoint
CREATE INDEX "job_document_workspace_org_idx" ON "kublai_job_document_workspace" USING btree ("organizationId","jobId");--> statement-breakpoint
CREATE INDEX "job_draw_item_line_idx" ON "kublai_job_draw_item" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "job_draw_line_job_idx" ON "kublai_job_draw_line" USING btree ("jobId","sortOrder");--> statement-breakpoint
CREATE INDEX "job_drawing_set_job_idx" ON "kublai_job_drawing_set" USING btree ("organizationId","jobId");--> statement-breakpoint
CREATE UNIQUE INDEX "drawing_document_version_set_idx" ON "kublai_job_drawing_set" USING btree ("documentVersionId") WHERE "kublai_job_drawing_set"."documentVersionId" is not null;--> statement-breakpoint
CREATE INDEX "job_drawing_sheet_set_idx" ON "kublai_job_drawing_sheet" USING btree ("setId","sortOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "drawing_document_version_page_idx" ON "kublai_job_drawing_sheet" USING btree ("documentVersionId","sortOrder") WHERE "kublai_job_drawing_sheet"."documentVersionId" is not null;--> statement-breakpoint
CREATE INDEX "job_draw_org_idx" ON "kublai_job_draw" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "job_floor_plan_org_idx" ON "kublai_job_floor_plan" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "job_floor_job_idx" ON "kublai_job_floor" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "job_floor_plan_idx" ON "kublai_job_floor" USING btree ("floorPlanId");--> statement-breakpoint
CREATE INDEX "job_order_approval_queue_idx" ON "kublai_job_order_approval" USING btree ("organizationId","jobId","status");--> statement-breakpoint
CREATE INDEX "job_price_list_org_idx" ON "kublai_job_price_list" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "job_pricing_audit_job_idx" ON "kublai_job_pricing_audit" USING btree ("organizationId","jobId","createdAt");--> statement-breakpoint
CREATE INDEX "job_room_floor_idx" ON "kublai_job_room" USING btree ("floorId");--> statement-breakpoint
CREATE INDEX "job_room_job_idx" ON "kublai_job_room" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "job_supplier_job_idx" ON "kublai_job_supplier" USING btree ("jobId");--> statement-breakpoint
CREATE UNIQUE INDEX "job_system_assessment_job_idx" ON "kublai_job_system_assessment" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "job_system_assessment_org_idx" ON "kublai_job_system_assessment" USING btree ("organizationId","jobId");--> statement-breakpoint
CREATE INDEX "job_org_idx" ON "kublai_job" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "job_org_updated_idx" ON "kublai_job" USING btree ("organizationId","updatedAt","id");--> statement-breakpoint
CREATE UNIQUE INDEX "estimating_job_org_unique" ON "kublai_job" USING btree ("id","organizationId");--> statement-breakpoint
CREATE INDEX "job_location_idx" ON "kublai_job" USING btree ("locationId");--> statement-breakpoint
CREATE INDEX "job_foreman_idx" ON "kublai_job" USING btree ("foremanUserId");--> statement-breakpoint
CREATE INDEX "location_org_idx" ON "kublai_location" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "material_list_sync_mutation_list_idx" ON "kublai_material_list_sync_mutation" USING btree ("materialListId");--> statement-breakpoint
CREATE INDEX "material_list_sync_tombstone_list_idx" ON "kublai_material_list_sync_tombstone" USING btree ("materialListId");--> statement-breakpoint
CREATE INDEX "material_list_sync_tombstone_deleted_idx" ON "kublai_material_list_sync_tombstone" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "material_list_sync_tombstone_org_deleted_idx" ON "kublai_material_list_sync_tombstone" USING btree ("organizationId","deletedAt","entityId");--> statement-breakpoint
CREATE INDEX "material_list_room_idx" ON "kublai_material_list" USING btree ("roomId");--> statement-breakpoint
CREATE INDEX "material_list_job_idx" ON "kublai_material_list" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "material_list_org_idx" ON "kublai_material_list" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "material_list_org_updated_idx" ON "kublai_material_list" USING btree ("organizationId","updatedAt","id");--> statement-breakpoint
CREATE INDEX "material_list_quote_idx" ON "kublai_material_list" USING btree ("quoteId");--> statement-breakpoint
CREATE INDEX "material_notification_recipient_idx" ON "kublai_material_notification" USING btree ("recipientId","createdAt","id");--> statement-breakpoint
CREATE INDEX "material_prefab_org_idx" ON "kublai_material_prefab" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX "material_push_ready_idx" ON "kublai_material_push_outbox" USING btree ("completedAt","availableAt","leasedUntil");--> statement-breakpoint
CREATE INDEX "material_org_idx" ON "kublai_material" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "order_item_room_idx" ON "kublai_order_item" USING btree ("roomId");--> statement-breakpoint
CREATE INDEX "order_item_order_idx" ON "kublai_order_item" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "order_item_part_idx" ON "kublai_order_item" USING btree ("partDefinitionId");--> statement-breakpoint
CREATE INDEX "order_job_idx" ON "kublai_order" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "order_material_list_idx" ON "kublai_order" USING btree ("materialListId");--> statement-breakpoint
CREATE INDEX "order_supplier_idx" ON "kublai_order" USING btree ("supplierId");--> statement-breakpoint
CREATE INDEX "order_org_idx" ON "kublai_order" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "organization_invite_org_idx" ON "kublai_organization_invite" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "organization_permission_preset_org_idx" ON "kublai_organization_permission_preset" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "organization_reporting_line_manager_idx" ON "kublai_organization_reporting_line" USING btree ("organizationId","reportsToUserId");--> statement-breakpoint
CREATE INDEX "part_attr_key_num_idx" ON "kublai_part_attribute" USING btree ("key","valueNum");--> statement-breakpoint
CREATE INDEX "part_def_org_idx" ON "kublai_part_definition" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "part_def_catalog_idx" ON "kublai_part_definition" USING btree ("catalogId");--> statement-breakpoint
CREATE INDEX "part_def_category_idx" ON "kublai_part_definition" USING btree ("categoryId");--> statement-breakpoint
CREATE INDEX "part_def_facets_idx" ON "kublai_part_definition" USING btree ("materialId","sizeId");--> statement-breakpoint
CREATE INDEX "part_def_material_idx" ON "kublai_part_definition" USING btree ("materialId");--> statement-breakpoint
CREATE INDEX "part_def_size_idx" ON "kublai_part_definition" USING btree ("sizeId");--> statement-breakpoint
CREATE INDEX "part_def_image_asset_idx" ON "kublai_part_definition" USING btree ("imageAssetId");--> statement-breakpoint
CREATE INDEX "part_def_group_sort_idx" ON "kublai_part_definition" USING btree ("organizationId","catalogId","materialId","sizeId","categoryId","sortOrder");--> statement-breakpoint
CREATE INDEX "part_synonym_part_idx" ON "kublai_part_synonym" USING btree ("partDefinitionId");--> statement-breakpoint
CREATE INDEX "photo_asset_org_created_idx" ON "kublai_photo_asset" USING btree ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "photo_asset_checksum_idx" ON "kublai_photo_asset" USING btree ("organizationId","checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "pipe_system_spec_company_idx" ON "kublai_pipe_system_spec" USING btree ("organizationId","system") WHERE "jobId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pipe_system_spec_job_idx" ON "kublai_pipe_system_spec" USING btree ("jobId","system") WHERE "jobId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pipe_system_spec_org_idx" ON "kublai_pipe_system_spec" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "pricing_profile_org_idx" ON "kublai_pricing_profile" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "quote_item_sent_order_idx" ON "kublai_quote_item" USING btree ("sentOrderItemId");--> statement-breakpoint
CREATE INDEX "quote_item_room_idx" ON "kublai_quote_item" USING btree ("roomId");--> statement-breakpoint
CREATE INDEX "quote_item_quote_idx" ON "kublai_quote_item" USING btree ("quoteId");--> statement-breakpoint
CREATE INDEX "quote_item_updated_idx" ON "kublai_quote_item" USING btree ("updatedAt","id");--> statement-breakpoint
CREATE INDEX "quote_item_part_idx" ON "kublai_quote_item" USING btree ("partDefinitionId");--> statement-breakpoint
CREATE INDEX "quote_item_supplier_idx" ON "kublai_quote_item" USING btree ("supplierId");--> statement-breakpoint
CREATE INDEX "quote_item_added_by_idx" ON "kublai_quote_item" USING btree ("addedByUserId");--> statement-breakpoint
CREATE INDEX "quote_job_idx" ON "kublai_quote" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "quote_material_list_idx" ON "kublai_quote" USING btree ("materialListId");--> statement-breakpoint
CREATE INDEX "replicache_client_group_org_idx" ON "kublai_replicache_client_group" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "replicache_client_group_idx" ON "kublai_replicache_client" USING btree ("clientGroupId");--> statement-breakpoint
CREATE INDEX "replicache_client_org_idx" ON "kublai_replicache_client" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "room_feedback_floor_idx" ON "kublai_room_detection_feedback" USING btree ("organizationId","floorId","createdAt");--> statement-breakpoint
CREATE INDEX "room_feedback_room_idx" ON "kublai_room_detection_feedback" USING btree ("roomId","createdAt");--> statement-breakpoint
CREATE INDEX "room_detection_job_org_idx" ON "kublai_room_detection_job" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "kublai_session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "size_org_idx" ON "kublai_size" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "super_scale_user_sheet_idx" ON "kublai_super_scale_job" USING btree ("userId","sheetId","createdAt");--> statement-breakpoint
CREATE INDEX "super_scale_queue_idx" ON "kublai_super_scale_job" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "supplier_part_supplier_idx" ON "kublai_supplier_part" USING btree ("supplierId");--> statement-breakpoint
CREATE INDEX "supplier_part_part_idx" ON "kublai_supplier_part" USING btree ("partDefinitionId");--> statement-breakpoint
CREATE INDEX "supplier_part_preferred_idx" ON "kublai_supplier_part" USING btree ("organizationId","partDefinitionId","isPreferred");--> statement-breakpoint
CREATE INDEX "supplier_org_idx" ON "kublai_supplier" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "supplier_org_updated_idx" ON "kublai_supplier" USING btree ("organizationId","updatedAt","id");--> statement-breakpoint
CREATE INDEX "supplier_location_idx" ON "kublai_supplier" USING btree ("locationId");--> statement-breakpoint
CREATE INDEX "time_entry_sheet_idx" ON "kublai_time_entry" USING btree ("sheetId");--> statement-breakpoint
CREATE INDEX "time_event_sheet_idx" ON "kublai_time_event" USING btree ("sheetId","createdAt");--> statement-breakpoint
CREATE INDEX "time_event_org_idx" ON "kublai_time_event" USING btree ("organizationId","createdAt","id");--> statement-breakpoint
CREATE INDEX "time_event_user_idx" ON "kublai_time_event" USING btree ("organizationId","userId","createdAt","id");--> statement-breakpoint
CREATE INDEX "time_sheet_org_period_idx" ON "kublai_time_sheet" USING btree ("organizationId","startDate");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_push_message_device_uniq" ON "kublai_chat_push_outbox" USING btree ("messageId","subscriptionId");--> statement-breakpoint
CREATE INDEX "chat_push_ready_idx" ON "kublai_chat_push_outbox" USING btree ("completedAt","availableAt","leasedUntil");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_push_endpoint_uniq" ON "kublai_chat_push_subscription" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "chat_push_user_idx" ON "kublai_chat_push_subscription" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "bim_activity_job_idx" ON "kublai_bim_activity" USING btree ("organizationId","jobId","createdAt");--> statement-breakpoint
CREATE INDEX "bim_design_job_idx" ON "kublai_bim_design" USING btree ("organizationId","jobId");--> statement-breakpoint
CREATE INDEX "bim_issue_job_idx" ON "kublai_bim_issue" USING btree ("organizationId","jobId");--> statement-breakpoint
CREATE UNIQUE INDEX "bim_model_series_version_uniq" ON "kublai_bim_model" USING btree ("seriesId","version");--> statement-breakpoint
CREATE INDEX "bim_model_job_idx" ON "kublai_bim_model" USING btree ("organizationId","jobId");--> statement-breakpoint
CREATE INDEX "bim_view_job_idx" ON "kublai_bim_view" USING btree ("organizationId","jobId");--> statement-breakpoint
ALTER TABLE "kublai_account" ADD CONSTRAINT "kublai_account_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_count_line" ADD CONSTRAINT "kublai_asset_count_line_countId_kublai_asset_count_id_fk" FOREIGN KEY ("countId") REFERENCES "public"."kublai_asset_count"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_count_line" ADD CONSTRAINT "kublai_asset_count_line_assetId_kublai_asset_id_fk" FOREIGN KEY ("assetId") REFERENCES "public"."kublai_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_count_line" ADD CONSTRAINT "kublai_asset_count_line_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_count" ADD CONSTRAINT "kublai_asset_count_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_count" ADD CONSTRAINT "kublai_asset_count_startedByUserId_kublai_user_id_fk" FOREIGN KEY ("startedByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_count" ADD CONSTRAINT "kublai_asset_count_completedByUserId_kublai_user_id_fk" FOREIGN KEY ("completedByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_location" ADD CONSTRAINT "kublai_asset_location_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_movement" ADD CONSTRAINT "kublai_asset_movement_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_movement" ADD CONSTRAINT "kublai_asset_movement_assetId_kublai_asset_id_fk" FOREIGN KEY ("assetId") REFERENCES "public"."kublai_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_movement" ADD CONSTRAINT "kublai_asset_movement_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_movement" ADD CONSTRAINT "kublai_asset_movement_orderId_kublai_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."kublai_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_movement" ADD CONSTRAINT "kublai_asset_movement_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_stock" ADD CONSTRAINT "kublai_asset_stock_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset_stock" ADD CONSTRAINT "kublai_asset_stock_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset" ADD CONSTRAINT "kublai_asset_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_asset" ADD CONSTRAINT "kublai_asset_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_catalog" ADD CONSTRAINT "kublai_catalog_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_category" ADD CONSTRAINT "kublai_category_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_attachment" ADD CONSTRAINT "kublai_conversation_attachment_conversationId_kublai_conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."kublai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_attachment" ADD CONSTRAINT "kublai_conversation_attachment_uploadedById_kublai_user_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_attachment" ADD CONSTRAINT "kublai_conversation_attachment_messageId_kublai_conversation_message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."kublai_conversation_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_member" ADD CONSTRAINT "kublai_conversation_member_conversationId_kublai_conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."kublai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_member" ADD CONSTRAINT "kublai_conversation_member_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_message" ADD CONSTRAINT "kublai_conversation_message_conversationId_kublai_conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."kublai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_message" ADD CONSTRAINT "kublai_conversation_message_authorId_kublai_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_push_outbox" ADD CONSTRAINT "kublai_conversation_push_outbox_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_push_outbox" ADD CONSTRAINT "kublai_conversation_push_outbox_conversationId_kublai_conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."kublai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_push_outbox" ADD CONSTRAINT "kublai_conversation_push_outbox_messageId_kublai_conversation_message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."kublai_conversation_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_push_outbox" ADD CONSTRAINT "kublai_conversation_push_outbox_subscriptionId_kublai_chat_push_subscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."kublai_chat_push_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation_push_outbox" ADD CONSTRAINT "kublai_conversation_push_outbox_recipientId_kublai_user_id_fk" FOREIGN KEY ("recipientId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation" ADD CONSTRAINT "kublai_conversation_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_conversation" ADD CONSTRAINT "kublai_conversation_createdById_kublai_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_drawing_legend_item" ADD CONSTRAINT "kublai_drawing_legend_item_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_drawing_legend_item" ADD CONSTRAINT "kublai_drawing_legend_item_setId_kublai_job_drawing_set_id_fk" FOREIGN KEY ("setId") REFERENCES "public"."kublai_job_drawing_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_drawing_legend_item" ADD CONSTRAINT "kublai_drawing_legend_item_sourceSheetId_kublai_job_drawing_sheet_id_fk" FOREIGN KEY ("sourceSheetId") REFERENCES "public"."kublai_job_drawing_sheet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_employee_simulation_audit" ADD CONSTRAINT "kublai_employee_simulation_audit_sessionId_kublai_employee_simulation_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."kublai_employee_simulation_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_employee_simulation_session" ADD CONSTRAINT "kublai_employee_simulation_session_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_entity_sync_mutation" ADD CONSTRAINT "kublai_entity_sync_mutation_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_entity_sync_mutation" ADD CONSTRAINT "kublai_entity_sync_mutation_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_estimate_revision" ADD CONSTRAINT "estimate_revision_estimate_org_fk" FOREIGN KEY ("estimateId","organizationId") REFERENCES "public"."kublai_estimate"("id","organizationId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_estimate" ADD CONSTRAINT "kublai_estimate_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_estimate" ADD CONSTRAINT "estimate_job_org_fk" FOREIGN KEY ("jobId","organizationId") REFERENCES "public"."kublai_job"("id","organizationId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_estimating_pricing" ADD CONSTRAINT "kublai_estimating_pricing_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_estimating_pricing_revision" ADD CONSTRAINT "kublai_estimating_pricing_revision_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_chat_attachment" ADD CONSTRAINT "kublai_job_chat_attachment_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_chat_attachment" ADD CONSTRAINT "kublai_job_chat_attachment_uploadedById_kublai_user_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_chat_attachment" ADD CONSTRAINT "kublai_job_chat_attachment_messageId_kublai_job_chat_message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."kublai_job_chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_chat_event" ADD CONSTRAINT "kublai_job_chat_event_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_chat_event" ADD CONSTRAINT "kublai_job_chat_event_messageId_kublai_job_chat_message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."kublai_job_chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_chat_member" ADD CONSTRAINT "kublai_job_chat_member_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_chat_member" ADD CONSTRAINT "kublai_job_chat_member_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_chat_message" ADD CONSTRAINT "kublai_job_chat_message_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_chat_message" ADD CONSTRAINT "kublai_job_chat_message_authorId_kublai_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_chat_message" ADD CONSTRAINT "kublai_job_chat_message_replyToId_kublai_job_chat_message_id_fk" FOREIGN KEY ("replyToId") REFERENCES "public"."kublai_job_chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_document_workspace" ADD CONSTRAINT "kublai_job_document_workspace_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_document_workspace" ADD CONSTRAINT "kublai_job_document_workspace_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_draw_item" ADD CONSTRAINT "kublai_job_draw_item_drawId_kublai_job_draw_id_fk" FOREIGN KEY ("drawId") REFERENCES "public"."kublai_job_draw"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_draw_item" ADD CONSTRAINT "kublai_job_draw_item_lineId_kublai_job_draw_line_id_fk" FOREIGN KEY ("lineId") REFERENCES "public"."kublai_job_draw_line"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_draw_line" ADD CONSTRAINT "kublai_job_draw_line_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_draw_line" ADD CONSTRAINT "kublai_job_draw_line_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_drawing_set" ADD CONSTRAINT "kublai_job_drawing_set_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_drawing_set" ADD CONSTRAINT "kublai_job_drawing_set_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_drawing_sheet" ADD CONSTRAINT "kublai_job_drawing_sheet_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_drawing_sheet" ADD CONSTRAINT "kublai_job_drawing_sheet_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_drawing_sheet" ADD CONSTRAINT "kublai_job_drawing_sheet_setId_kublai_job_drawing_set_id_fk" FOREIGN KEY ("setId") REFERENCES "public"."kublai_job_drawing_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_draw" ADD CONSTRAINT "kublai_job_draw_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_draw" ADD CONSTRAINT "kublai_job_draw_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_draw" ADD CONSTRAINT "kublai_job_draw_createdByUserId_kublai_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_floor_plan" ADD CONSTRAINT "kublai_job_floor_plan_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_floor_plan" ADD CONSTRAINT "kublai_job_floor_plan_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_floor" ADD CONSTRAINT "kublai_job_floor_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_floor" ADD CONSTRAINT "kublai_job_floor_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_floor" ADD CONSTRAINT "kublai_job_floor_floorPlanId_kublai_job_floor_plan_id_fk" FOREIGN KEY ("floorPlanId") REFERENCES "public"."kublai_job_floor_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_order_approval" ADD CONSTRAINT "kublai_job_order_approval_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_order_approval" ADD CONSTRAINT "kublai_job_order_approval_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_order_approval" ADD CONSTRAINT "kublai_job_order_approval_materialListId_kublai_material_list_id_fk" FOREIGN KEY ("materialListId") REFERENCES "public"."kublai_material_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_order_approval" ADD CONSTRAINT "kublai_job_order_approval_supplierId_kublai_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_order_approval" ADD CONSTRAINT "kublai_job_order_approval_requestedBy_kublai_user_id_fk" FOREIGN KEY ("requestedBy") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_order_approval" ADD CONSTRAINT "kublai_job_order_approval_requestedByActor_kublai_user_id_fk" FOREIGN KEY ("requestedByActor") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_order_approval" ADD CONSTRAINT "kublai_job_order_approval_reviewedBy_kublai_user_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_order_approval" ADD CONSTRAINT "kublai_job_order_approval_reviewedByActor_kublai_user_id_fk" FOREIGN KEY ("reviewedByActor") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_price_entry" ADD CONSTRAINT "kublai_job_price_entry_priceListId_kublai_job_price_list_id_fk" FOREIGN KEY ("priceListId") REFERENCES "public"."kublai_job_price_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_price_entry" ADD CONSTRAINT "kublai_job_price_entry_supplierPriceBookEntryId_kublai_supplier_price_book_entry_id_fk" FOREIGN KEY ("supplierPriceBookEntryId") REFERENCES "public"."kublai_supplier_price_book_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_price_entry" ADD CONSTRAINT "kublai_job_price_entry_supplierPartId_kublai_supplier_part_id_fk" FOREIGN KEY ("supplierPartId") REFERENCES "public"."kublai_supplier_part"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_price_list" ADD CONSTRAINT "kublai_job_price_list_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_price_list" ADD CONSTRAINT "kublai_job_price_list_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_pricing_audit" ADD CONSTRAINT "kublai_job_pricing_audit_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_pricing_audit" ADD CONSTRAINT "kublai_job_pricing_audit_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_pricing_audit" ADD CONSTRAINT "kublai_job_pricing_audit_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_pricing_audit" ADD CONSTRAINT "kublai_job_pricing_audit_actorUserId_kublai_user_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_room" ADD CONSTRAINT "kublai_job_room_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_room" ADD CONSTRAINT "kublai_job_room_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_room" ADD CONSTRAINT "kublai_job_room_floorId_kublai_job_floor_id_fk" FOREIGN KEY ("floorId") REFERENCES "public"."kublai_job_floor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_supplier_price_book" ADD CONSTRAINT "kublai_job_supplier_price_book_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_supplier_price_book" ADD CONSTRAINT "kublai_job_supplier_price_book_supplierId_kublai_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_supplier_price_book" ADD CONSTRAINT "kublai_job_supplier_price_book_bookId_kublai_supplier_price_book_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."kublai_supplier_price_book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_supplier" ADD CONSTRAINT "kublai_job_supplier_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_supplier" ADD CONSTRAINT "kublai_job_supplier_supplierId_kublai_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_system_assessment" ADD CONSTRAINT "kublai_job_system_assessment_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job_system_assessment" ADD CONSTRAINT "kublai_job_system_assessment_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job" ADD CONSTRAINT "kublai_job_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job" ADD CONSTRAINT "kublai_job_locationId_kublai_location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."kublai_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job" ADD CONSTRAINT "kublai_job_createdByUserId_kublai_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job" ADD CONSTRAINT "kublai_job_foremanUserId_kublai_user_id_fk" FOREIGN KEY ("foremanUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_job" ADD CONSTRAINT "kublai_job_pricingProfileId_kublai_pricing_profile_id_fk" FOREIGN KEY ("pricingProfileId") REFERENCES "public"."kublai_pricing_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_location" ADD CONSTRAINT "kublai_location_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list_sync_mutation" ADD CONSTRAINT "kublai_material_list_sync_mutation_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list_sync_mutation" ADD CONSTRAINT "kublai_material_list_sync_mutation_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list_sync_mutation" ADD CONSTRAINT "kublai_material_list_sync_mutation_materialListId_kublai_material_list_id_fk" FOREIGN KEY ("materialListId") REFERENCES "public"."kublai_material_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list_sync_tombstone" ADD CONSTRAINT "kublai_material_list_sync_tombstone_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list" ADD CONSTRAINT "kublai_material_list_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list" ADD CONSTRAINT "kublai_material_list_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list" ADD CONSTRAINT "kublai_material_list_roomId_kublai_job_room_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."kublai_job_room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list" ADD CONSTRAINT "kublai_material_list_quoteId_kublai_quote_id_fk" FOREIGN KEY ("quoteId") REFERENCES "public"."kublai_quote"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_list" ADD CONSTRAINT "kublai_material_list_createdByUserId_kublai_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_notification" ADD CONSTRAINT "kublai_material_notification_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_notification" ADD CONSTRAINT "kublai_material_notification_materialListId_kublai_material_list_id_fk" FOREIGN KEY ("materialListId") REFERENCES "public"."kublai_material_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_notification" ADD CONSTRAINT "kublai_material_notification_senderId_kublai_user_id_fk" FOREIGN KEY ("senderId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_notification" ADD CONSTRAINT "kublai_material_notification_recipientId_kublai_user_id_fk" FOREIGN KEY ("recipientId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_prefab_item" ADD CONSTRAINT "kublai_material_prefab_item_prefabId_kublai_material_prefab_id_fk" FOREIGN KEY ("prefabId") REFERENCES "public"."kublai_material_prefab"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_prefab_item" ADD CONSTRAINT "kublai_material_prefab_item_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_prefab_item" ADD CONSTRAINT "kublai_material_prefab_item_supplierPartId_kublai_supplier_part_id_fk" FOREIGN KEY ("supplierPartId") REFERENCES "public"."kublai_supplier_part"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_prefab" ADD CONSTRAINT "kublai_material_prefab_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_push_outbox" ADD CONSTRAINT "kublai_material_push_outbox_notificationId_kublai_material_notification_id_fk" FOREIGN KEY ("notificationId") REFERENCES "public"."kublai_material_notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material_push_outbox" ADD CONSTRAINT "kublai_material_push_outbox_subscriptionId_kublai_chat_push_subscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."kublai_chat_push_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_material" ADD CONSTRAINT "kublai_material_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order_delivery_preferences" ADD CONSTRAINT "kublai_order_delivery_preferences_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order_item" ADD CONSTRAINT "kublai_order_item_orderId_kublai_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."kublai_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order_item" ADD CONSTRAINT "kublai_order_item_roomId_kublai_job_room_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."kublai_job_room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order_item" ADD CONSTRAINT "kublai_order_item_supplierPartId_kublai_supplier_part_id_fk" FOREIGN KEY ("supplierPartId") REFERENCES "public"."kublai_supplier_part"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order_item" ADD CONSTRAINT "kublai_order_item_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order_item" ADD CONSTRAINT "kublai_order_item_uomId_kublai_unit_id_fk" FOREIGN KEY ("uomId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order" ADD CONSTRAINT "kublai_order_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order" ADD CONSTRAINT "kublai_order_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order" ADD CONSTRAINT "kublai_order_materialListId_kublai_material_list_id_fk" FOREIGN KEY ("materialListId") REFERENCES "public"."kublai_material_list"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order" ADD CONSTRAINT "kublai_order_supplierId_kublai_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_order" ADD CONSTRAINT "kublai_order_createdByUserId_kublai_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_organization_department_lead" ADD CONSTRAINT "kublai_organization_department_lead_organizationId_departmentId_kublai_organization_department_organizationId_id_fk" FOREIGN KEY ("organizationId","departmentId") REFERENCES "public"."kublai_organization_department"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_organization_department_lead" ADD CONSTRAINT "kublai_organization_department_lead_organizationId_userId_kublai_user_organizationId_id_fk" FOREIGN KEY ("organizationId","userId") REFERENCES "public"."kublai_user"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_organization_department" ADD CONSTRAINT "kublai_organization_department_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_organization_invite" ADD CONSTRAINT "kublai_organization_invite_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_organization_invite" ADD CONSTRAINT "kublai_organization_invite_createdByUserId_kublai_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_organization_permission_preset" ADD CONSTRAINT "kublai_organization_permission_preset_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_organization_reporting_line" ADD CONSTRAINT "kublai_organization_reporting_line_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_organization_reporting_line" ADD CONSTRAINT "kublai_organization_reporting_line_organizationId_userId_kublai_user_organizationId_id_fk" FOREIGN KEY ("organizationId","userId") REFERENCES "public"."kublai_user"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_organization_reporting_line" ADD CONSTRAINT "kublai_organization_reporting_line_organizationId_reportsToUserId_kublai_user_organizationId_id_fk" FOREIGN KEY ("organizationId","reportsToUserId") REFERENCES "public"."kublai_user"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_attribute" ADD CONSTRAINT "kublai_part_attribute_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_attribute" ADD CONSTRAINT "kublai_part_attribute_unitId_kublai_unit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_catalogId_kublai_catalog_id_fk" FOREIGN KEY ("catalogId") REFERENCES "public"."kublai_catalog"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_categoryId_kublai_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."kublai_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_imageAssetId_kublai_photo_asset_id_fk" FOREIGN KEY ("imageAssetId") REFERENCES "public"."kublai_photo_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_materialId_kublai_material_id_fk" FOREIGN KEY ("materialId") REFERENCES "public"."kublai_material"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_definition" ADD CONSTRAINT "kublai_part_definition_sizeId_kublai_size_id_fk" FOREIGN KEY ("sizeId") REFERENCES "public"."kublai_size"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_part_synonym" ADD CONSTRAINT "kublai_part_synonym_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_photo_asset" ADD CONSTRAINT "kublai_photo_asset_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_pipe_system_spec" ADD CONSTRAINT "kublai_pipe_system_spec_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_pipe_system_spec" ADD CONSTRAINT "kublai_pipe_system_spec_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_pricing_profile" ADD CONSTRAINT "kublai_pricing_profile_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quantity_unit" ADD CONSTRAINT "kublai_quantity_unit_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_quoteId_kublai_quote_id_fk" FOREIGN KEY ("quoteId") REFERENCES "public"."kublai_quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_sentOrderItemId_kublai_order_item_id_fk" FOREIGN KEY ("sentOrderItemId") REFERENCES "public"."kublai_order_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_roomId_kublai_job_room_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."kublai_job_room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_supplierPartId_kublai_supplier_part_id_fk" FOREIGN KEY ("supplierPartId") REFERENCES "public"."kublai_supplier_part"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_supplierId_kublai_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_oneOffSizeUnitId_kublai_unit_id_fk" FOREIGN KEY ("oneOffSizeUnitId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_uomId_kublai_unit_id_fk" FOREIGN KEY ("uomId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote_item" ADD CONSTRAINT "kublai_quote_item_addedByUserId_kublai_user_id_fk" FOREIGN KEY ("addedByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote" ADD CONSTRAINT "kublai_quote_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote" ADD CONSTRAINT "kublai_quote_materialListId_kublai_material_list_id_fk" FOREIGN KEY ("materialListId") REFERENCES "public"."kublai_material_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote" ADD CONSTRAINT "kublai_quote_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_quote" ADD CONSTRAINT "kublai_quote_createdByUserId_kublai_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_replicache_client_group" ADD CONSTRAINT "kublai_replicache_client_group_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_replicache_client_group" ADD CONSTRAINT "kublai_replicache_client_group_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_replicache_client" ADD CONSTRAINT "kublai_replicache_client_clientGroupId_kublai_replicache_client_group_id_fk" FOREIGN KEY ("clientGroupId") REFERENCES "public"."kublai_replicache_client_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_replicache_client" ADD CONSTRAINT "kublai_replicache_client_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_replicache_client" ADD CONSTRAINT "kublai_replicache_client_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_room_detection_feedback" ADD CONSTRAINT "kublai_room_detection_feedback_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_room_detection_feedback" ADD CONSTRAINT "kublai_room_detection_feedback_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_room_detection_feedback" ADD CONSTRAINT "kublai_room_detection_feedback_floorId_kublai_job_floor_id_fk" FOREIGN KEY ("floorId") REFERENCES "public"."kublai_job_floor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_room_detection_feedback" ADD CONSTRAINT "kublai_room_detection_feedback_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_room_detection_job" ADD CONSTRAINT "kublai_room_detection_job_floorId_kublai_job_floor_id_fk" FOREIGN KEY ("floorId") REFERENCES "public"."kublai_job_floor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_room_detection_job" ADD CONSTRAINT "kublai_room_detection_job_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_session" ADD CONSTRAINT "kublai_session_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_size" ADD CONSTRAINT "kublai_size_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_size" ADD CONSTRAINT "kublai_size_unitId_kublai_unit_id_fk" FOREIGN KEY ("unitId") REFERENCES "public"."kublai_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_email_preference" ADD CONSTRAINT "kublai_supplier_email_preference_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_email_preference" ADD CONSTRAINT "kublai_supplier_email_preference_supplierId_kublai_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_email_preference" ADD CONSTRAINT "kublai_supplier_email_preference_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_part" ADD CONSTRAINT "kublai_supplier_part_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_part" ADD CONSTRAINT "kublai_supplier_part_supplierId_kublai_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_part" ADD CONSTRAINT "kublai_supplier_part_partDefinitionId_kublai_part_definition_id_fk" FOREIGN KEY ("partDefinitionId") REFERENCES "public"."kublai_part_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_part" ADD CONSTRAINT "kublai_supplier_part_packUomId_kublai_unit_id_fk" FOREIGN KEY ("packUomId") REFERENCES "public"."kublai_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_price_book_entry" ADD CONSTRAINT "kublai_supplier_price_book_entry_bookId_kublai_supplier_price_book_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."kublai_supplier_price_book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_price_book_entry" ADD CONSTRAINT "kublai_supplier_price_book_entry_supplierPartId_kublai_supplier_part_id_fk" FOREIGN KEY ("supplierPartId") REFERENCES "public"."kublai_supplier_part"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_price_book" ADD CONSTRAINT "kublai_supplier_price_book_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier_price_book" ADD CONSTRAINT "kublai_supplier_price_book_supplierId_kublai_supplier_id_fk" FOREIGN KEY ("supplierId") REFERENCES "public"."kublai_supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier" ADD CONSTRAINT "kublai_supplier_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_supplier" ADD CONSTRAINT "kublai_supplier_locationId_kublai_location_id_fk" FOREIGN KEY ("locationId") REFERENCES "public"."kublai_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_time_clock" ADD CONSTRAINT "kublai_time_clock_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_time_clock" ADD CONSTRAINT "kublai_time_clock_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_time_clock" ADD CONSTRAINT "kublai_time_clock_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_time_entry" ADD CONSTRAINT "kublai_time_entry_sheetId_kublai_time_sheet_id_fk" FOREIGN KEY ("sheetId") REFERENCES "public"."kublai_time_sheet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_time_entry" ADD CONSTRAINT "kublai_time_entry_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_time_event" ADD CONSTRAINT "kublai_time_event_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_time_event" ADD CONSTRAINT "kublai_time_event_sheetId_kublai_time_sheet_id_fk" FOREIGN KEY ("sheetId") REFERENCES "public"."kublai_time_sheet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_time_settings" ADD CONSTRAINT "kublai_time_settings_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_time_sheet" ADD CONSTRAINT "kublai_time_sheet_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_time_sheet" ADD CONSTRAINT "kublai_time_sheet_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_time_sheet" ADD CONSTRAINT "kublai_time_sheet_reviewerId_kublai_user_id_fk" FOREIGN KEY ("reviewerId") REFERENCES "public"."kublai_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_user" ADD CONSTRAINT "kublai_user_permissionPresetId_kublai_organization_permission_preset_id_fk" FOREIGN KEY ("permissionPresetId") REFERENCES "public"."kublai_organization_permission_preset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_user" ADD CONSTRAINT "kublai_user_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_user" ADD CONSTRAINT "kublai_user_pricingProfileId_kublai_pricing_profile_id_fk" FOREIGN KEY ("pricingProfileId") REFERENCES "public"."kublai_pricing_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_user" ADD CONSTRAINT "kublai_user_currentJobId_kublai_job_id_fk" FOREIGN KEY ("currentJobId") REFERENCES "public"."kublai_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_chat_push_outbox" ADD CONSTRAINT "kublai_chat_push_outbox_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_chat_push_outbox" ADD CONSTRAINT "kublai_chat_push_outbox_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_chat_push_outbox" ADD CONSTRAINT "kublai_chat_push_outbox_messageId_kublai_job_chat_message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."kublai_job_chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_chat_push_outbox" ADD CONSTRAINT "kublai_chat_push_outbox_subscriptionId_kublai_chat_push_subscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."kublai_chat_push_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_chat_push_outbox" ADD CONSTRAINT "kublai_chat_push_outbox_recipientId_kublai_user_id_fk" FOREIGN KEY ("recipientId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_chat_push_subscription" ADD CONSTRAINT "kublai_chat_push_subscription_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_app_device_observation" ADD CONSTRAINT "kublai_app_device_observation_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_activity" ADD CONSTRAINT "kublai_bim_activity_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_activity" ADD CONSTRAINT "kublai_bim_activity_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_activity" ADD CONSTRAINT "bim_activity_job_org_fk" FOREIGN KEY ("jobId","organizationId") REFERENCES "public"."kublai_job"("id","organizationId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_design" ADD CONSTRAINT "kublai_bim_design_modelId_kublai_bim_model_id_fk" FOREIGN KEY ("modelId") REFERENCES "public"."kublai_bim_model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_design" ADD CONSTRAINT "kublai_bim_design_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_design" ADD CONSTRAINT "bim_design_job_org_fk" FOREIGN KEY ("jobId","organizationId") REFERENCES "public"."kublai_job"("id","organizationId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_issue" ADD CONSTRAINT "kublai_bim_issue_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_issue" ADD CONSTRAINT "kublai_bim_issue_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_issue" ADD CONSTRAINT "bim_issue_job_org_fk" FOREIGN KEY ("jobId","organizationId") REFERENCES "public"."kublai_job"("id","organizationId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_model" ADD CONSTRAINT "kublai_bim_model_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_model" ADD CONSTRAINT "kublai_bim_model_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_model" ADD CONSTRAINT "bim_model_job_org_fk" FOREIGN KEY ("jobId","organizationId") REFERENCES "public"."kublai_job"("id","organizationId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_view" ADD CONSTRAINT "kublai_bim_view_organizationId_kublai_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."kublai_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_view" ADD CONSTRAINT "kublai_bim_view_jobId_kublai_job_id_fk" FOREIGN KEY ("jobId") REFERENCES "public"."kublai_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kublai_bim_view" ADD CONSTRAINT "bim_view_job_org_fk" FOREIGN KEY ("jobId","organizationId") REFERENCES "public"."kublai_job"("id","organizationId") ON DELETE cascade ON UPDATE no action;