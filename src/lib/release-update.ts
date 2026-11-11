export interface UpdateConnection { saveData?: boolean; effectiveType?: string; downlink?: number }
export function goodUpdateLink(online: boolean, connection?: UpdateConnection) {
  return online && !!connection && !connection.saveData && connection.effectiveType === "4g" &&
    (connection.downlink === undefined || connection.downlink >= 1.5);
}
export function quietForRelease(now: number, lastInteraction: number, mutations: number, editing: boolean) {
  return now - lastInteraction >= 5000 && mutations === 0 && !editing;
}
export function isChunkFailure(message: unknown) {
  return typeof message === "string" && /ChunkLoadError|Loading (?:CSS )?chunk .+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message);
}
export function reloadReleaseOnce(build: string | undefined, storage: Pick<Storage, "getItem" | "setItem">, reload: () => void) {
  if (!build || !/^[a-f0-9]{64}$/.test(build)) return false;
  try {
    const key = `foremenhq:release-reload:${build}`;
    if (storage.getItem(key)) return false;
    storage.setItem(key, "1");
  } catch { return false; }
  reload();
  return true;
}
