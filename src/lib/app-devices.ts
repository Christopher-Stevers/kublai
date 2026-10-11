export const APP_DEVICE_TYPES = [
  "phone",
  "tablet",
  "computer",
  "unknown",
] as const;
export type AppDeviceType = (typeof APP_DEVICE_TYPES)[number];
export function appDeviceType(ua: string, touchPoints = 0): AppDeviceType {
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1))
    return "tablet";
  if (/iPhone|iPod/i.test(ua)) return "phone";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "phone" : "tablet";
  if (/Windows|Macintosh|X11|Linux/i.test(ua)) return "computer";
  return "unknown";
}

export type AppDeviceObservation = {
  deviceId: string;
  userId: string;
  deviceType: AppDeviceType;
  platform: string;
  mode: "browser" | "installed-app";
  installButtonVisible: boolean;
  lastSeenAt: string;
  installedAppLastSeenAt: string | null;
};

export type AppDevicePlatform =
  | "Android"
  | "iPhone"
  | "iPad"
  | "Windows"
  | "Mac"
  | "Linux"
  | "Other";
export function appDevicePlatform(
  ua: string,
  touchPoints = 0,
): AppDevicePlatform {
  if (ua.includes('iPad') || (ua.includes('Macintosh') && touchPoints > 1))
    return "iPad";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (ua.includes('Android')) return "Android";
  if (ua.includes('Windows')) return "Windows";
  if (ua.includes('Macintosh')) return "Mac";
  if (/Linux|X11/.test(ua)) return "Linux";
  return "Other";
}

let deviceId: string | undefined;
/** Browser-profile identifier only; no hardware fingerprint or advertising ID. */
export function getAppDeviceId() {
  if (deviceId) return deviceId;
  try {
    const saved = localStorage.getItem("foremanhq.app-device-id");
    if (
      saved &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        saved,
      )
    ) {
      deviceId = saved;
      return saved;
    }
    deviceId = crypto.randomUUID();
    localStorage.setItem("foremanhq.app-device-id", deviceId);
  } catch {
    deviceId ??= crypto.randomUUID();
  }
  return deviceId;
}
