export const PUSH_DEVICE_TYPES = [
  "phone",
  "tablet",
  "computer",
  "unknown",
] as const;
export type PushDeviceType = (typeof PUSH_DEVICE_TYPES)[number];

/** A device hint, not proof that the operating system displayed an alert. */
export function pushDeviceType(
  userAgent: string,
  touchPoints = 0,
): PushDeviceType {
  if (
    /iPad|Tablet/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && touchPoints > 1)
  )
    return "tablet";
  if (/iPhone|iPod/i.test(userAgent)) return "phone";
  if (/Android/i.test(userAgent))
    return /Mobile/i.test(userAgent) ? "phone" : "tablet";
  if (/Windows|Macintosh|X11|Linux/i.test(userAgent)) return "computer";
  return "unknown";
}

export type MemberNotificationStatus = {
  state: "ready" | "not-enabled" | "access-blocked" | "server-unavailable";
  devices: number;
  phones: number;
  tablets: number;
  computers: number;
  unknownDevices: number;
  mutedJobs: number;
  pending: number;
  failed: number;
  lastSentAt: string | null;
};

export function notificationStatusLabel(status: MemberNotificationStatus) {
  if (status.state === "access-blocked") return "Push paused · access";
  if (status.state === "server-unavailable") return "Push unavailable";
  if (status.state === "not-enabled") return "Push not enabled";
  if (status.failed) return "Push needs attention";
  if (status.pending) return "Push queued";
  return status.phones ? "Phone push enabled" : "Push enabled";
}
