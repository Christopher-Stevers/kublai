const OFFLINE_ID_MAP_KEY = "foremanhq.offline.id-map";
export const OFFLINE_ID_MAP_CHANGED_EVENT = "foremanhq:offline-id-map-changed";

export type OfflineIdMap = Record<string, string>;

export function getOfflineIdMap(): OfflineIdMap {
  if (typeof window === "undefined") return {};

  try {
    return JSON.parse(window.localStorage.getItem(OFFLINE_ID_MAP_KEY) ?? "{}") as OfflineIdMap;
  } catch {
    return {};
  }
}

export function resolveOfflineId(id: string) {
  return getOfflineIdMap()[id] ?? id;
}

export function setOfflineIdMappings(mappings: OfflineIdMap) {
  if (typeof window === "undefined") return;

  const existingMap = getOfflineIdMap();
  window.localStorage.setItem(
    OFFLINE_ID_MAP_KEY,
    JSON.stringify({ ...existingMap, ...mappings }),
  );
  window.dispatchEvent(new Event(OFFLINE_ID_MAP_CHANGED_EVENT));
}
