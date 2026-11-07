import type { ChatAttachment } from "~/server/chat/contracts";

export type DraftAttachment = {
  localId: string;
  name: string;
  size: number;
  type: string;
  uploaded?: ChatAttachment;
  file?: File;
};
export type ChatDraft = {
  clientId: string;
  body: string;
  replyToId?: string;
  replyName?: string;
  replyBody?: string;
  attachments: DraftAttachment[];
  attempted?: boolean;
};
export function newChatDraft(): ChatDraft {
  return { clientId: crypto.randomUUID(), body: "", attachments: [] };
}

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("foremanhq-job-chat-drafts", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("drafts");
      request.result.createObjectStore("files");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Draft storage unavailable."));
    request.onblocked = () =>
      reject(new Error("Close other ForemanHQ tabs to enable draft storage."));
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  return database;
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not read draft."));
  });
}
function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () =>
      reject(tx.error ?? new Error("Could not save draft."));
  });
}
function fileKey(key: string, id: string) {
  return `${key}:${id}`;
}
const storedFiles = new Set<string>();

export async function loadChatDraft(key: string): Promise<ChatDraft | null> {
  await writes.get(key)?.catch(() => {
    /* A later write/read may retry after a storage failure. */
  });
  const db = await openDatabase();
  const tx = db.transaction(["drafts", "files"], "readonly");
  const draft = (await requestResult(tx.objectStore("drafts").get(key))) as
    | ChatDraft
    | undefined;
  if (!draft) return null;
  const attachments = await Promise.all(
    draft.attachments.map(async (attachment) => {
      const id = fileKey(key, attachment.localId);
      const file = (await requestResult(tx.objectStore("files").get(id))) as
        | File
        | undefined;
      if (file) storedFiles.add(id);
      return { ...attachment, file };
    }),
  );
  return { ...draft, attachments };
}

// Serialize writes per identity/job so a slow attachment save cannot restore a
// draft after successful delivery has cleared it. File bytes are written once.
const writes = new Map<string, Promise<void>>();
export function saveChatDraft(
  key: string,
  draft: ChatDraft | null,
): Promise<void> {
  const write = (writes.get(key) ?? Promise.resolve())
    .catch(() => {
      /* A later write/read may retry after a storage failure. */
    })
    .then(async () => {
      const db = await openDatabase();
      const tx = db.transaction(["drafts", "files"], "readwrite");
      const done = transactionDone(tx);
      const oldRequest = tx.objectStore("drafts").get(key);
      oldRequest.onsuccess = () => {
        const old = oldRequest.result as ChatDraft | undefined;
        const keep = new Set(draft?.attachments.map((file) => file.localId));
        for (const file of old?.attachments ?? []) {
          if (!keep.has(file.localId)) {
            const id = fileKey(key, file.localId);
            tx.objectStore("files").delete(id);
            storedFiles.delete(id);
          }
        }
        if (!draft) {
          tx.objectStore("drafts").delete(key);
          return;
        }
        tx.objectStore("drafts").put(
          {
            ...draft,
            attachments: draft.attachments.map(
              ({ file: _file, ...attachment }) => attachment,
            ),
          },
          key,
        );
        for (const attachment of draft.attachments) {
          const id = fileKey(key, attachment.localId);
          if (attachment.file && !storedFiles.has(id))
            tx.objectStore("files").put(attachment.file, id);
        }
      };
      await done;
      for (const attachment of draft?.attachments ?? [])
        if (attachment.file) storedFiles.add(fileKey(key, attachment.localId));
    });
  writes.set(key, write);
  void write
    .finally(() => {
      if (writes.get(key) === write) writes.delete(key);
    })
    .catch(() => {
      /* A later write/read may retry after a storage failure. */
    });
  return write;
}

export function mergeChatMessages<T extends { id: string; sequence: number }>(
  ...pages: T[][]
): T[] {
  const unique = new Map<string, T>();
  for (const messages of pages)
    for (const message of messages) unique.set(message.id, message);
  return [...unique.values()].sort((a, b) => a.sequence - b.sequence);
}
