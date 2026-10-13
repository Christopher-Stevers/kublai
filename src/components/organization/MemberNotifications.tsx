"use client";

import { Bell, BellOff, Smartphone, CircleAlert } from "lucide-react";
import {
  notificationStatusLabel,
  type MemberNotificationStatus,
} from "~/lib/member-notifications";
import { cn } from "~/lib/utils";

export function MemberPushBadge({
  status,
}: {
  status: MemberNotificationStatus | null | undefined;
}) {
  if (!status) return null;
  const ready = status.state === "ready";
  const Icon = status.failed && ready ? CircleAlert : ready ? Bell : BellOff;
  return (
    <span
      className={cn(
        "mt-1.5 inline-flex items-center gap-1 text-[11px]",
        ready && !status.failed
          ? "text-emerald-700 dark:text-emerald-400"
          : "text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {notificationStatusLabel(status)}
    </span>
  );
}

export function MemberNotifications({
  status,
}: {
  status: MemberNotificationStatus | null | undefined;
}) {
  if (!status) return null;
  const reason =
    status.state === "not-enabled"
      ? "No device is registered. They need to enable notifications from the bell on their own phone."
      : status.state === "access-blocked"
        ? "Push is paused because this member does not have approved dashboard access."
        : status.state === "server-unavailable"
          ? "Push delivery is unavailable because the server is not configured."
          : "Eligible job chat, private chat and drawing alerts can be sent to these registered devices.";
  const phoneLabel = status.phones
    ? `${status.phones} phone${status.phones === 1 ? "" : "s"} registered`
    : status.unknownDevices
      ? "Phone status unknown"
      : "No phone registered";
  return (
    <section
      aria-label="Push notification status"
      className="space-y-4 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Bell className="h-4 w-4" /> Notifications
        </h3>
        <MemberPushBadge status={status} />
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">{reason}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium">
            <Smartphone className="h-4 w-4" />
            {phoneLabel}
          </div>
          <p className="text-muted-foreground text-xs">
            {status.devices} registered device{status.devices === 1 ? "" : "s"}{" "}
            · {status.computers} computer{status.computers === 1 ? "" : "s"} ·{" "}
            {status.tablets} tablet{status.tablets === 1 ? "" : "s"}
          </p>
          {status.unknownDevices > 0 && (
            <p className="text-muted-foreground mt-1 text-xs">
              {status.unknownDevices} device
              {status.unknownDevices === 1 ? "" : "s"} unidentified. Their type
              updates when the member opens the app with notifications allowed.
            </p>
          )}
        </div>
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-sm font-medium">
            {status.mutedJobs} muted job chat{status.mutedJobs === 1 ? "" : "s"}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Muted job chats do not send push alerts. Other eligible alerts can
            still be sent.
          </p>
        </div>
      </div>
      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">
            Last accepted by push provider
          </dt>
          <dd className="mt-1 font-medium">
            {status.lastSentAt
              ? new Date(status.lastSentAt).toLocaleString()
              : "None recorded in the last 7 days"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            Sending activity · last 7 days
          </dt>
          <dd className="mt-1 font-medium">
            {status.pending} queued · {status.failed} failed
          </dd>
        </div>
      </dl>
      <p className="text-muted-foreground border-t pt-3 text-xs leading-relaxed">
        A registered phone can receive alerts even when the app is closed.
        Registration and provider acceptance do not confirm that an alert
        appeared or was read. Phone permissions, Focus and notification settings
        can silence it.
      </p>
    </section>
  );
}
