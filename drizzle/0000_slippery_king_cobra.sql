CREATE TABLE "genghis_account" (
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
	CONSTRAINT "genghis_account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "genghis_backfill" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hours" integer NOT NULL,
	"startTime" timestamp with time zone NOT NULL,
	"endTime" timestamp with time zone NOT NULL,
	"boardId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "genghis_board_type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"imageUrl" text
);
--> statement-breakpoint
CREATE TABLE "genghis_board" (
	"id" uuid PRIMARY KEY NOT NULL,
	"boardTypeId" uuid NOT NULL,
	"vehicleName" varchar(255),
	"vehicleDescription" text
);
--> statement-breakpoint
CREATE TABLE "genghis_creative_for_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"orderId" uuid NOT NULL,
	"creativeId" uuid NOT NULL,
	CONSTRAINT "genghis_creative_for_order_orderId_creativeId_unique" UNIQUE("orderId","creativeId")
);
--> statement-breakpoint
CREATE TABLE "genghis_creative" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"uploadDate" timestamp with time zone NOT NULL,
	"approved" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "genghis_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"totalPrice" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'cad',
	"status" varchar(50),
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"stripePaymentIntentId" varchar(255),
	"isSubsidizedBySubscription" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "genghis_session" (
	"sessionToken" varchar(255) PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "genghis_slot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"boardId" uuid NOT NULL,
	"startTime" timestamp with time zone NOT NULL,
	"endTime" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "genghis_user" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"email" varchar(255) NOT NULL,
	"emailVerified" timestamp with time zone,
	"image" varchar(255),
	"stripeCustomerId" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "genghis_verification_token" (
	"identifier" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "genghis_verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "genghis_account" ADD CONSTRAINT "genghis_account_userId_genghis_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."genghis_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genghis_backfill" ADD CONSTRAINT "genghis_backfill_boardId_genghis_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."genghis_board"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genghis_board" ADD CONSTRAINT "genghis_board_boardTypeId_genghis_board_type_id_fk" FOREIGN KEY ("boardTypeId") REFERENCES "public"."genghis_board_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genghis_creative_for_order" ADD CONSTRAINT "genghis_creative_for_order_orderId_genghis_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."genghis_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genghis_creative_for_order" ADD CONSTRAINT "genghis_creative_for_order_creativeId_genghis_creative_id_fk" FOREIGN KEY ("creativeId") REFERENCES "public"."genghis_creative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genghis_order" ADD CONSTRAINT "genghis_order_userId_genghis_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."genghis_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genghis_session" ADD CONSTRAINT "genghis_session_userId_genghis_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."genghis_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genghis_slot" ADD CONSTRAINT "genghis_slot_boardId_genghis_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."genghis_board"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "genghis_account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "t_user_id_idx" ON "genghis_session" USING btree ("userId");