import { z } from "zod";

export const notificationKind = z.enum(["drawing", "job-chat", "conversation"]);
export type NotificationKind = z.infer<typeof notificationKind>;
export const notificationReadTarget = z.object({
  kind: notificationKind,
  id: z.uuid(),
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});
export type NotificationReadTarget = z.infer<typeof notificationReadTarget>;
export const notificationCursor = z.object({
  createdAt: z.iso.datetime(),
  id: z.string().max(100),
});
export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  context: string;
  description: string;
  createdAt: string;
  unread: boolean;
  url: string;
  target: NotificationReadTarget;
};

export const NOTIFICATION_POLL_MS = 30_000;
export const NOTIFICATION_REMINDER_MS = 60_000;

export function notificationBadge(count: number) {
  return count > 99 ? "99+" : String(count);
}
