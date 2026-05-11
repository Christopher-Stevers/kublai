export type SyncDebugStatus = "info" | "success" | "warning" | "error";

export type SyncDebugEvent = {
  id: string;
  at: string;
  phase:
    | "local-write"
    | "queued"
    | "wake"
    | "lock"
    | "parent-sync"
    | "push"
    | "server-result"
    | "queue-drain"
    | "pull"
    | "hydrate"
    | "done"
    | "blocked";
  status: SyncDebugStatus;
  message: string;
  materialListId?: string;
  mutationIds?: string[];
  queueLength?: number;
  details?: unknown;
};

export const SYNC_DEBUG_TIMELINE_EVENT = "foremanhq:sync-debug-timeline";

const SYNC_DEBUG_TIMELINE_KEY = "foremanhq.sync-debug.timeline";
const MAX_TIMELINE_EVENTS = 80;
const MAX_DETAILS_JSON_LENGTH = 2_500;

function canUseTimeline() {
  return process.env.NODE_ENV !== "production" && typeof window !== "undefined";
}

function eventId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function trimDetails(details: unknown) {
  if (details === undefined) return undefined;

  try {
    const json = JSON.stringify(details);
    if (json.length <= MAX_DETAILS_JSON_LENGTH) return details;
    return {
      truncated: true,
      preview: json.slice(0, MAX_DETAILS_JSON_LENGTH),
      originalLength: json.length,
    };
  } catch {
    return { unserializable: true, preview: String(details) };
  }
}

function compactEvent(event: SyncDebugEvent): SyncDebugEvent {
  return {
    id: event.id,
    at: event.at,
    phase: event.phase,
    status: event.status,
    message: event.message,
    materialListId: event.materialListId,
    mutationIds: event.mutationIds?.slice(0, 12),
    queueLength: event.queueLength,
    details: trimDetails(event.details),
  };
}

export function getSyncDebugTimeline(): SyncDebugEvent[] {
  if (!canUseTimeline()) return [];

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SYNC_DEBUG_TIMELINE_KEY) ?? "[]",
    ) as SyncDebugEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addSyncDebugEvent(
  event: Omit<SyncDebugEvent, "id" | "at"> & { at?: string },
) {
  if (!canUseTimeline()) return;

  const nextEvent = compactEvent({
    id: eventId(),
    at: event.at ?? new Date().toISOString(),
    ...event,
  });

  try {
    const nextTimeline = [...getSyncDebugTimeline(), nextEvent].slice(-MAX_TIMELINE_EVENTS);
    window.localStorage.setItem(SYNC_DEBUG_TIMELINE_KEY, JSON.stringify(nextTimeline));
  } catch {
    // Debug logging must never break the sync runner. If localStorage is full,
    // keep only the current compact event; if that fails too, dispatch it in-memory.
    try {
      window.localStorage.setItem(SYNC_DEBUG_TIMELINE_KEY, JSON.stringify([nextEvent]));
    } catch {
      // Ignore. The event dispatch below still updates open panels in this tab.
    }
  }

  try {
    window.dispatchEvent(new CustomEvent(SYNC_DEBUG_TIMELINE_EVENT, { detail: nextEvent }));
  } catch {
    // Debug timeline events are best effort only.
  }
}

export function clearSyncDebugTimeline() {
  if (!canUseTimeline()) return;
  try {
    window.localStorage.removeItem(SYNC_DEBUG_TIMELINE_KEY);
  } catch {
    // Ignore localStorage failures in debug tooling.
  }
  window.dispatchEvent(new Event(SYNC_DEBUG_TIMELINE_EVENT));
}
