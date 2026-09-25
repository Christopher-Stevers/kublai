/**
 * Tool QR labels encode a URL ending in /dashboard/assets/scan/<tag>, so a
 * phone's camera app opens the tool directly. In-app scanners and keyboard
 * wedge scanners may hand us that URL or just the bare tag; accept both.
 */
export function tagFromScan(text: string) {
  const trimmed = text.trim();
  const match = /\/assets\/scan\/([^/?#\s]+)/i.exec(trimmed);
  const raw = match?.[1] ?? trimmed;
  let tag = raw;
  try {
    tag = decodeURIComponent(raw);
  } catch {
    // Not URI-encoded; use as typed.
  }
  return tag.trim().toUpperCase();
}

export function toolScanPath(tag: string) {
  return `/dashboard/assets/scan/${encodeURIComponent(tag)}`;
}
