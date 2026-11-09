let pending: Promise<boolean> | undefined;
/** Request browser eviction protection; denial must never block offline use. */
export function requestPersistentDeviceStorage(): Promise<boolean> {
  if (pending) return pending;
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return Promise.resolve(false);
  const storage = navigator.storage;
  pending = (async () => {
    try {
      if (await storage.persisted?.()) return true;
      return await storage.persist();
    } catch { return false; }
  })().finally(() => { pending = undefined; });
  return pending;
}
