CREATE TABLE "kublai_app_device_observation" (
  "userId" varchar(255) NOT NULL REFERENCES "kublai_user"("id") ON DELETE CASCADE,
  "deviceId" uuid NOT NULL,
  "deviceType" varchar(16) NOT NULL CHECK ("deviceType" IN ('phone','tablet','computer','unknown')),
  "platform" varchar(16) NOT NULL CHECK ("platform" IN ('Android','iPhone','iPad','Windows','Mac','Linux','Other')),
  "mode" varchar(16) NOT NULL CHECK ("mode" IN ('browser','installed-app')),
  "installButtonVisible" boolean NOT NULL,
  "lastSeenAt" timestamptz NOT NULL DEFAULT now(),
  "installedAppLastSeenAt" timestamptz,
  PRIMARY KEY ("userId", "deviceId")
);
