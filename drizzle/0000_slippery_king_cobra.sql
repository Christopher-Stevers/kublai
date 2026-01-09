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
	CONSTRAINT "kublai_account_provider_providerAccountId_pk" PRIMARY KEY("provider", "providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "kublai_backfill" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hours" integer NOT NULL,
	"startTime" timestamp with time zone NOT NULL,
	"endTime" timestamp with time zone NOT NULL,
	"boardId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_board_type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"imageUrl" text
);
--> statement-breakpoint
CREATE TABLE "kublai_board" (
	"id" uuid PRIMARY KEY NOT NULL,
	"boardTypeId" uuid NOT NULL,
	"vehicleName" varchar(255),
	"vehicleDescription" text
);
--> statement-breakpoint
CREATE TABLE "kublai_creative_for_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"orderId" uuid NOT NULL,
	"creativeId" uuid NOT NULL,
	CONSTRAINT "kublai_creative_for_order_orderId_creativeId_unique" UNIQUE("orderId", "creativeId")
);
--> statement-breakpoint
CREATE TABLE "kublai_creative" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"uploadDate" timestamp with time zone NOT NULL,
	"approved" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "kublai_order" (
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
CREATE TABLE "kublai_session" (
	"sessionToken" varchar(255) PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_slot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"boardId" uuid NOT NULL,
	"startTime" timestamp with time zone NOT NULL,
	"endTime" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kublai_user" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"email" varchar(255) NOT NULL,
	"emailVerified" timestamp with time zone,
	"image" varchar(255),
	"stripeCustomerId" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "kublai_verification_token" (
	"identifier" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "kublai_verification_token_identifier_token_pk" PRIMARY KEY("identifier", "token")
);
--> statement-breakpoint
ALTER TABLE "kublai_account"
ADD CONSTRAINT "kublai_account_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_backfill"
ADD CONSTRAINT "kublai_backfill_boardId_kublai_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."kublai_board"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_board"
ADD CONSTRAINT "kublai_board_boardTypeId_kublai_board_type_id_fk" FOREIGN KEY ("boardTypeId") REFERENCES "public"."kublai_board_type"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_creative_for_order"
ADD CONSTRAINT "kublai_creative_for_order_orderId_kublai_order_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."kublai_order"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_creative_for_order"
ADD CONSTRAINT "kublai_creative_for_order_creativeId_kublai_creative_id_fk" FOREIGN KEY ("creativeId") REFERENCES "public"."kublai_creative"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_order"
ADD CONSTRAINT "kublai_order_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_session"
ADD CONSTRAINT "kublai_session_userId_kublai_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kublai_slot"
ADD CONSTRAINT "kublai_slot_boardId_kublai_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."kublai_board"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "kublai_account" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX "t_user_id_idx" ON "kublai_session" USING btree ("userId");