/** One persistent model slot shared by all viewer tabs on this browser. */
const DATABASE = "foreman-current-model";
const STORE = "model";
type Slot = { token: string; url: string; version: string; blob?: Blob };

async function slot<T>(
  change: (current: Slot | undefined) => { value: T; next?: Slot },
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Model storage unavailable"));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const read = store.get("current");
      let value: T;
      read.onsuccess = () => {
        const result = change(read.result as Slot | undefined);
        value = result.value;
        // Clearing first also removes any unexpected older entries.
        store.clear();
        if (result.next) store.put(result.next, "current");
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Model storage failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Model storage failed"));
    });
  } finally {
    db.close();
  }
}

export async function deviceModelDownload(url: string, signal: AbortSignal) {
  // Authorize every reopen, but never transfer the model body on a cache hit.
  const metadata = await fetch(url, {
    method: "HEAD",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!metadata.ok) {
    if ([401, 403, 404].includes(metadata.status))
      await slot(() => ({ value: undefined })).catch(() => undefined);
    throw Error(
      metadata.status === 401
        ? "Sign in again to open this model."
        : "This model is not available. Check your access and try again.",
    );
  }
  const version = metadata.headers.get("etag");
  const token = crypto.randomUUID();
  let cached: Blob | undefined;
  if (version) {
    cached = await slot((current) => {
      const blob =
        current?.url === url && current.version === version
          ? current.blob
          : undefined;
      return { value: blob, next: { token, url, version, blob } };
    }).catch(() => undefined);
  }
  signal.throwIfAborted();
  const response = cached
    ? new Response(cached, {
        headers: { "Content-Length": String(cached.size) },
      })
    : await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
  return {
    response,
    cached: !!cached,
    async save(bytes: Uint8Array<ArrayBuffer>) {
      if (
        cached ||
        !version ||
        signal.aborted ||
        response.headers.get("etag") !== version
      )
        return;
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      // A late download from another tab must not overwrite a newer selection.
      await slot((current) => ({
        value: undefined,
        next:
          current?.token === token && !signal.aborted
            ? { token, url, version, blob }
            : current,
      })).catch(() => undefined); // Full/disabled storage must not prevent viewing.
    },
  };
}
