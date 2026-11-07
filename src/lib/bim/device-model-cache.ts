import { MAX_MODEL_BYTES } from "./types";

/** One persistent model slot shared by installed-app viewer tabs. */
const DATABASE = "foreman-current-model";
const STORE = "model";
const CHUNKS = "chunks";
const CHECKPOINT_BYTES = 1024 * 1024;
type Slot = {
  token: string;
  url: string;
  version: string;
  size?: number;
  received?: number;
  blob?: Blob;
};
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      for (const name of [STORE, CHUNKS])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? Error("Model storage unavailable"));
  });
}
async function slot<T>(
  change: (current: Slot | undefined) => { value: T; next?: Slot },
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction([STORE, CHUNKS], "readwrite");
      const store = transaction.objectStore(STORE);
      const read = store.get("current");
      let value: T;
      read.onsuccess = () => {
        const current = read.result as Slot | undefined;
        const result = change(current);
        value = result.value;
        const next = result.next;
        if (
          !next ||
          next.url !== current?.url ||
          next.version !== current.version ||
          next.blob ||
          (!next.received && current.received)
        )
          transaction.objectStore(CHUNKS).clear();
        store.clear();
        if (next) store.put(next, "current");
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? Error("Model storage failed"));
    });
  } finally {
    db.close();
  }
}
/** Commit bytes and their offset together; stale tabs cannot append to a new model. */
async function append(token: string, offset: number, blob: Blob) {
  const db = await database();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([STORE, CHUNKS], "readwrite");
      const store = transaction.objectStore(STORE);
      const read = store.get("current");
      let saved = false;
      read.onsuccess = () => {
        const current = read.result as Slot | undefined;
        if (
          current?.token !== token ||
          current.blob ||
          (current.received ?? 0) !== offset
        )
          return;
        transaction.objectStore(CHUNKS).put(blob, offset);
        store.put({ ...current, received: offset + blob.size }, "current");
        saved = true;
      };
      transaction.oncomplete = () => resolve(saved);
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? Error("Model checkpoint failed"));
    });
  } finally {
    db.close();
  }
}
async function prefix(token: string, received: number) {
  const db = await database();
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const transaction = db.transaction([STORE, CHUNKS], "readonly");
      const read = transaction.objectStore(STORE).get("current");
      let result: Blob | undefined;
      read.onsuccess = () => {
        if ((read.result as Slot | undefined)?.token !== token) return;
        const chunks: Blob[] = [];
        let offset = 0;
        const cursor = transaction.objectStore(CHUNKS).openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) {
            if (offset === received) result = new Blob(chunks);
            return;
          }
          if (row.key !== offset || !(row.value instanceof Blob)) return;
          chunks.push(row.value);
          offset += row.value.size;
          row.continue();
        };
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? Error("Model checkpoint unavailable"));
    });
  } finally {
    db.close();
  }
}

export async function deviceModelDownload(
  url: string,
  signal: AbortSignal,
  installedApp = false,
) {
  const fetchOptions = {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  } as const;
  const noSave = async (_bytes: Uint8Array<ArrayBuffer>) => undefined;
  if (!installedApp)
    return {
      response: await fetch(url, fetchOptions),
      cached: false,
      resumed: false,
      save: noSave,
    };
  // Recheck authorization and content identity before using any saved bytes.
  const metadata = await fetch(url, { ...fetchOptions, method: "HEAD" });
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
  const contentLength = Number(metadata.headers.get("content-length"));
  const size =
    Number.isSafeInteger(contentLength) && contentLength > 0
      ? contentLength
      : 0;
  if (size > MAX_MODEL_BYTES)
    throw Error("This model exceeds the 250 MB viewing limit.");
  if (!version || version.startsWith("W/"))
    return {
      response: await fetch(url, fetchOptions),
      cached: false,
      resumed: false,
      save: noSave,
    };
  const token = crypto.randomUUID();
  const previous = await slot((current) => {
    const same =
      current?.url === url &&
      current.version === version &&
      (!size || current.size === size || current.blob?.size === size);
    const blob = same ? current.blob : undefined;
    const received =
      same && size && (current.received ?? 0) <= size
        ? (current.received ?? 0)
        : 0;
    return {
      value: { blob, received },
      next: { token, url, version, size, blob, received },
    };
  }).catch(() => ({ blob: undefined, received: 0 }));
  let savedPrefix =
    previous.blob ??
    (previous.received
      ? await prefix(token, previous.received).catch(() => undefined)
      : undefined);
  const reset = () =>
    slot((current) => ({
      value: undefined,
      next:
        current?.token === token
          ? { token, url, version, size, received: 0 }
          : current,
    })).catch(() => undefined);
  if (!savedPrefix && previous.received) await reset();
  signal.throwIfAborted();
  if (savedPrefix && (previous.blob || savedPrefix.size === size)) {
    return {
      response: new Response(savedPrefix, {
        headers: { "Content-Length": String(savedPrefix.size) },
      }),
      cached: true,
      resumed: false,
      save: noSave,
    };
  }
  let offset = savedPrefix?.size ?? 0;
  const network = await fetch(url, {
    ...fetchOptions,
    ...(offset
      ? { headers: { Range: `bytes=${offset}-`, "If-Range": version } }
      : {}),
  });
  if ([401, 403, 404].includes(network.status)) await reset();
  if (!network.ok)
    return { response: network, cached: false, resumed: false, save: noSave };
  if (network.headers.get("etag") !== version) {
    await network.body?.cancel();
    await reset();
    throw Error(
      "The model changed during download. Open it again to download the latest version.",
    );
  }
  if (offset && network.status === 200) {
    // A proxy/server may ignore Range. Start from the full body instead of duplicating bytes.
    savedPrefix = undefined;
    offset = 0;
    await reset();
  } else if (network.status === 206) {
    const range = network.headers
      .get("content-range")
      ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (
      !range ||
      Number(range[1]) !== offset ||
      Number(range[2]) !== size - 1 ||
      Number(range[3]) !== size
    ) {
      await network.body?.cancel();
      throw Error(
        "The model download could not be resumed safely. Try opening it again.",
      );
    }
  }
  const resumed = offset > 0;
  const reader = network.body?.getReader();
  if (!reader)
    return { response: network, cached: false, resumed, save: noSave };
  const prefixReader = savedPrefix?.stream().getReader();
  let pending: Uint8Array<ArrayBuffer>[] = [],
    pendingBytes = 0,
    received = offset,
    downloaded = offset;
  let persistence = size > 0;
  const flush = async () => {
    if (!pendingBytes) return;
    if (persistence) {
      const blob = new Blob(pending);
      persistence = await append(token, received, blob).catch(() => false);
      if (persistence) received += blob.size;
    }
    pending = [];
    pendingBytes = 0;
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (prefixReader) {
          const next = await prefixReader.read();
          if (!next.done) {
            controller.enqueue(next.value);
            return;
          }
        }
        const next = await reader.read();
        if (next.done) {
          await flush();
          if (size && downloaded !== size)
            throw Error(
              "The model download was interrupted. Open it again to resume.",
            );
          controller.close();
          reader.releaseLock();
          return;
        }
        downloaded += next.value.byteLength;
        if (downloaded > MAX_MODEL_BYTES)
          throw Error("This model exceeds the 250 MB viewing limit.");
        if (size && downloaded > size)
          throw Error("The model download size changed. Open it again.");
        if (persistence) {
          pending.push(new Uint8Array(next.value));
          pendingBytes += next.value.byteLength;
          if (pendingBytes >= CHECKPOINT_BYTES) await flush();
        }
        controller.enqueue(next.value);
      } catch (error) {
        await flush();
        await reader.cancel().catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(reason) {
      await flush();
      await prefixReader?.cancel(reason).catch(() => undefined);
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  const headers = new Headers(network.headers);
  headers.delete("content-range");
  if (size) headers.set("content-length", String(size));
  return {
    response: new Response(body, { status: 200, headers }),
    cached: false,
    resumed,
    async save(bytes: Uint8Array<ArrayBuffer>) {
      if (signal.aborted || (size && bytes.byteLength !== size)) return;
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      await slot((current) => ({
        value: undefined,
        next:
          current?.token === token && !signal.aborted
            ? { token, url, version, size: bytes.byteLength, blob }
            : current,
      })).catch(() => undefined);
    },
  };
}
