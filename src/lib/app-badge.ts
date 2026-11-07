/** Home-screen badges are separate from the notification's small status icon. */
export async function updateAppBadge(count: number) {
  if (typeof navigator === "undefined" || !Number.isSafeInteger(count) || count < 0) return;
  const badges = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) await badges.setAppBadge?.(count);
    else await badges.clearAppBadge?.();
  } catch {
    // Permission or platform support must not affect the notification inbox.
  }
}
