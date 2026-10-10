CREATE TABLE IF NOT EXISTS kublai_material_notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES kublai_organization(id) ON DELETE CASCADE,
  "materialListId" uuid NOT NULL REFERENCES kublai_material_list(id) ON DELETE CASCADE,
  "senderId" varchar(255) NOT NULL REFERENCES kublai_user(id) ON DELETE CASCADE,
  "recipientId" varchar(255) NOT NULL REFERENCES kublai_user(id) ON DELETE CASCADE,
  "eventKey" text NOT NULL,
  action varchar(16) NOT NULL CONSTRAINT material_notification_action_check CHECK (action IN ('added','edited')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "readAt" timestamptz,
  CONSTRAINT material_notification_event_recipient_uniq UNIQUE ("organizationId","eventKey","recipientId")
);
CREATE INDEX IF NOT EXISTS material_notification_recipient_idx ON kublai_material_notification ("recipientId","createdAt" DESC,id);
CREATE TABLE IF NOT EXISTS kublai_material_push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notificationId" uuid NOT NULL REFERENCES kublai_material_notification(id) ON DELETE CASCADE,
  "subscriptionId" uuid NOT NULL REFERENCES kublai_chat_push_subscription(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  "availableAt" timestamptz NOT NULL DEFAULT now(),
  "leaseToken" uuid,
  "leasedUntil" timestamptz,
  "completedAt" timestamptz,
  outcome varchar(32),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_push_notification_device_uniq UNIQUE ("notificationId","subscriptionId")
);
CREATE INDEX IF NOT EXISTS material_push_ready_idx ON kublai_material_push_outbox ("completedAt","availableAt","leasedUntil");
