import { safeSnapshotHref, type SnapshotSource } from "./snapshot-source";

export const SNAPSHOT_EDIT_MESSAGE = "editSnapshot";
export const SNAPSHOT_EDIT_CHAT = "snapshotChat";
export function snapshotEditHref(snapshot: {
  id: string;
  conversationId: string;
  source?: SnapshotSource | null;
}) {
  const fallback = `/dashboard/chat?conversation=${encodeURIComponent(snapshot.conversationId)}`;
  const href =
    snapshot.source && safeSnapshotHref(snapshot.source.href)
      ? snapshot.source.href
      : fallback;
  const url = new URL(href, "https://snapshot.invalid");
  url.searchParams.set(SNAPSHOT_EDIT_MESSAGE, snapshot.id);
  url.searchParams.set(SNAPSHOT_EDIT_CHAT, snapshot.conversationId);
  return `${url.pathname}${url.search}${url.hash}`;
}
