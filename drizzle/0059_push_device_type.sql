ALTER TABLE "kublai_chat_push_subscription" ADD COLUMN "deviceType" varchar(16) NOT NULL DEFAULT 'unknown';
ALTER TABLE "kublai_chat_push_subscription" ADD CONSTRAINT "chat_push_device_type_valid" CHECK ("deviceType" IN ('phone', 'tablet', 'computer', 'unknown'));
