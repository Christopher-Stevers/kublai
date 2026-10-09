import {
  drawingSaveSchema,
  type DrawingEntity,
  type DrawingSave,
} from "./drawing-workspace";
import { isDrawingOfflineAccountActive } from "./drawing-offline";
export const DRAWING_QUEUE_LIMIT = 200;
export const DRAWING_QUEUE_BYTES = 8 * 1024 * 1024;
const DATABASE = "foremanhq-drawing-edits-v1";
const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 6;
export type DrawingQueuedMutation = {
  operationId: string;
  accountKey: string;
  jobId: string;
  sheetId: string;
  input: DrawingSave;
  preview: DrawingEntity;
  state: "pending" | "syncing" | "conflict" | "blocked";
  error: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  availableAt: number;
  leaseToken: string | null;
  leaseUntil: number;
};
let database: Promise<IDBDatabase> | undefined;
let listening = false;
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("edits", {
        keyPath: ["accountKey", "operationId"],
      });
      store.createIndex("account", "accountKey");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () =>
      reject(
        request.error ??
          new Error("Offline edits could not be saved on this device."),
      );
    request.onblocked = () =>
      reject(
        new Error("Close other ForemanHQ tabs to open offline edit storage."),
      );
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  return database;
}
async function purgeOtherAccounts(accountKey: string | null) {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("edits", "readwrite");
    const request = tx.objectStore("edits").openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const row = cursor.value as DrawingQueuedMutation;
      // A delayed cleanup can revoke stale records, never erase the newly active account.
      if (
        row.accountKey !== accountKey &&
        !isDrawingOfflineAccountActive(row.accountKey)
      )
        cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () =>
      reject(tx.error ?? new Error("Offline edit cleanup failed."));
  });
}
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener(
    "foremanhq-drawing-offline-binding-change",
    (event) => {
      const key =
        (event as CustomEvent<{ accountKey: string | null }>).detail
          ?.accountKey ?? null;
      void purgeOtherAccounts(key).catch(() => undefined);
    },
  );
}
function errorDetails(error: unknown) {
  const object =
    typeof error === "object" && error !== null
      ? (error as {
          message?: unknown;
          code?: unknown;
          data?: { code?: unknown };
        })
      : {};
  return {
    code:
      typeof object.data?.code === "string"
        ? object.data.code
        : typeof object.code === "string"
          ? object.code
          : "",
    message:
      typeof object.message === "string"
        ? object.message.slice(0, 1000)
        : "This edit could not be synced. Reconnect and try again.",
  };
}
/** Durable private field edits. No whole-workspace replacement, offline publishing or silent CAS rebasing. */
export class DrawingOfflineQueue {
  private disposed = false;
  private flushing = false;
  private ready: Promise<void>;
  constructor(
    readonly accountKey: string,
    readonly userId: string,
  ) {
    if (!accountKey || !userId)
      throw new Error("A verified drawing account is required.");
    this.assertActive();
    listen();
    this.ready = purgeOtherAccounts(accountKey);
  }
  private assertActive() {
    if (this.disposed || !isDrawingOfflineAccountActive(this.accountKey))
      throw new DOMException(
        "The drawing account changed. Reopen your account before syncing.",
        "AbortError",
      );
  }
  private async transaction<T>(
    change: (records: DrawingQueuedMutation[], store: IDBObjectStore) => T,
  ): Promise<T> {
    this.assertActive();
    await this.ready;
    const db = await openDatabase();
    this.assertActive();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("edits", "readwrite"),
        store = tx.objectStore("edits");
      let value: T;
      let failure: Error | undefined;
      const request = store.index("account").getAll(this.accountKey);
      request.onsuccess = () => {
        try {
          this.assertActive();
          value = change(request.result as DrawingQueuedMutation[], store);
        } catch (error) {
          failure =
            error instanceof Error
              ? error
              : new Error("Offline edit storage failed.");
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        try {
          this.assertActive();
          resolve(value);
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error("Offline edit storage failed."),
          );
        }
      };
      tx.onerror = tx.onabort = () =>
        reject(
          failure ??
            tx.error ??
            new Error(
              "Offline edits could not be saved. Device storage may be full.",
            ),
        );
    });
  }
  async list(filter: { jobId?: string; sheetId?: string } = {}) {
    return this.transaction((records) =>
      records
        .filter(
          (record) =>
            (!filter.jobId || record.jobId === filter.jobId) &&
            (!filter.sheetId || record.sheetId === filter.sheetId),
        )
        .sort(
          (a, b) =>
            a.createdAt - b.createdAt ||
            a.operationId.localeCompare(b.operationId),
        ),
    );
  }
  async enqueue(options: {
    jobId: string;
    input: DrawingSave;
    baseEntity?: DrawingEntity;
    authorName?: string;
  }): Promise<DrawingQueuedMutation> {
    const input = drawingSaveSchema.parse({
      ...options.input,
      expectedUserId: this.userId,
    });
    if (
      input.visibility !== "private" ||
      (input.kind !== "markup" && input.kind !== "issue")
    )
      throw new Error(
        "Only private markup and issue drafts can be edited offline. Publish while connected.",
      );
    if (!/^[0-9a-f-]{36}$/i.test(options.jobId))
      throw new Error("Invalid drawing job.");
    return this.transaction((records, store) => {
      const previous = records.find((record) => record.input.id === input.id);
      if (
        previous &&
        (previous.sheetId !== input.sheetId || previous.jobId !== options.jobId)
      )
        throw new Error("An offline edit cannot move to a different drawing.");
      if (previous && previous.state !== "pending")
        throw new Error(
          "Resolve or finish syncing the previous edit before changing this item.",
        );
      const base = options.baseEntity;
      if (
        input.expectedRevision > 0 &&
        !previous &&
        (!base ||
          base.id !== input.id ||
          base.sheetId !== input.sheetId ||
          base.authorId !== this.userId ||
          base.visibility !== "private" ||
          base.revision !== input.expectedRevision)
      )
        throw new Error(
          "Download your current private annotation before editing it offline.",
        );
      if (
        base &&
        "sourceSheetId" in base.data &&
        base.data.sourceSheetId !== input.data.sourceSheetId
      )
        throw new Error(
          "An annotation cannot move to another drawing revision.",
        );
      const draft = {
        ...input,
        expectedRevision:
          previous?.input.expectedRevision ?? input.expectedRevision,
      };
      const now = Date.now();
      const common = {
        id: draft.id,
        sheetId: draft.sheetId,
        revision: draft.expectedRevision,
        visibility: "private" as const,
        authorId: this.userId,
        authorName:
          base?.authorName ??
          previous?.preview.authorName ??
          options.authorName ??
          "Me",
        createdAt:
          base?.createdAt ??
          previous?.preview.createdAt ??
          new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        comments: base?.comments ?? previous?.preview.comments ?? [],
      };
      const preview: DrawingEntity =
        draft.kind === "markup"
          ? { ...common, kind: "markup", data: draft.data }
          : { ...common, kind: "issue", data: draft.data };
      const record: DrawingQueuedMutation = {
        operationId: previous?.operationId ?? crypto.randomUUID(),
        accountKey: this.accountKey,
        jobId: options.jobId,
        sheetId: draft.sheetId,
        input: draft,
        preview,
        state: "pending",
        error: null,
        attempts: 0,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        availableAt: now,
        leaseToken: null,
        leaseUntil: 0,
      };
      const others = records.filter(
        (item) => item.operationId !== record.operationId,
      );
      const bytes = new TextEncoder().encode(
        JSON.stringify([...others, record]),
      ).length;
      if (others.length >= DRAWING_QUEUE_LIMIT || bytes > DRAWING_QUEUE_BYTES)
        throw new Error(
          "Offline edit storage is full. Sync or discard earlier drafts first.",
        );
      store.put(record);
      return record;
    });
  }
  async discard(operationId: string) {
    return this.transaction((records, store) => {
      const item = records.find((record) => record.operationId === operationId);
      if (item?.state === "syncing" && item.leaseUntil > Date.now())
        throw new Error(
          "This edit is currently syncing. Wait before discarding it.",
        );
      store.delete([this.accountKey, operationId]);
    });
  }
  async retry(operationId: string) {
    return this.transaction((records, store) => {
      const item = records.find((record) => record.operationId === operationId);
      if (!item) return;
      if (item.state === "conflict")
        throw new Error(
          "Review the current server version, then copy your draft or discard it. Conflicts are never overwritten automatically.",
        );
      if (item.state === "syncing" && item.leaseUntil > Date.now())
        throw new Error("This edit is currently syncing.");
      store.put({
        ...item,
        state: "pending",
        error: null,
        attempts: 0,
        availableAt: Date.now(),
        leaseUntil: 0,
        leaseToken: null,
      } satisfies DrawingQueuedMutation);
    });
  }
  private async claim(filter: { jobId?: string; sheetId?: string }) {
    return this.transaction((records, store) => {
      const now = Date.now();
      const candidates = records
        .filter(
          (row) =>
            (!filter.jobId || row.jobId === filter.jobId) &&
            (!filter.sheetId || row.sheetId === filter.sheetId) &&
            ((row.state === "pending" && row.availableAt <= now) ||
              (row.state === "syncing" && row.leaseUntil <= now)),
        )
        .sort((a, b) => a.createdAt - b.createdAt);
      for (const exhausted of candidates.filter(
        (item) => item.attempts >= MAX_ATTEMPTS,
      )) {
        store.put({
          ...exhausted,
          state: "blocked",
          error:
            "This edit could not be synced after several attempts. Review it and retry.",
          leaseToken: null,
          leaseUntil: 0,
        } satisfies DrawingQueuedMutation);
      }
      const item = candidates.find((entry) => entry.attempts < MAX_ATTEMPTS);
      if (!item) return null;
      const claimed: DrawingQueuedMutation = {
        ...item,
        state: "syncing",
        attempts: item.attempts + 1,
        leaseToken: crypto.randomUUID(),
        leaseUntil: now + LEASE_MS,
        updatedAt: now,
      };
      store.put(claimed);
      return claimed;
    });
  }
  async flush(options: {
    jobId?: string;
    sheetId?: string;
    save: (input: DrawingSave) => Promise<DrawingEntity>;
    onChange?: () => void | Promise<void>;
    onSaved?: (entity: DrawingEntity) => void | Promise<void>;
  }) {
    this.assertActive();
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (let count = 0; count < DRAWING_QUEUE_LIMIT; count++) {
        this.assertActive();
        const claimed = await this.claim(options);
        if (!claimed) break;
        await options.onChange?.();
        try {
          this.assertActive();
          // The server checks expectedUserId and live permissions, even if cookies changed since download.
          const saved = await options.save({
            ...claimed.input,
            expectedUserId: this.userId,
          });
          this.assertActive();
          if (
            saved.id !== claimed.input.id ||
            saved.sheetId !== claimed.sheetId ||
            saved.authorId !== this.userId
          )
            throw new Error(
              "Server returned a different annotation. Review this draft before retrying.",
            );
          await this.transaction((records, store) => {
            const current = records.find(
              (record) => record.operationId === claimed.operationId,
            );
            if (current?.leaseToken === claimed.leaseToken)
              store.delete([this.accountKey, claimed.operationId]);
          });
          await options.onSaved?.(saved);
        } catch (error) {
          this.assertActive();
          const detail = errorDetails(error);
          const permanent = [
            "FORBIDDEN",
            "UNAUTHORIZED",
            "BAD_REQUEST",
            "NOT_FOUND",
            "PAYLOAD_TOO_LARGE",
          ].includes(detail.code);
          const state =
            detail.code === "CONFLICT"
              ? "conflict"
              : permanent || claimed.attempts >= MAX_ATTEMPTS
                ? "blocked"
                : "pending";
          await this.transaction((records, store) => {
            const current = records.find(
              (record) => record.operationId === claimed.operationId,
            );
            if (current?.leaseToken === claimed.leaseToken)
              store.put({
                ...current,
                state,
                error: detail.message,
                availableAt:
                  Date.now() +
                  Math.min(60_000, 1000 * 2 ** (claimed.attempts - 1)),
                leaseToken: null,
                leaseUntil: 0,
                updatedAt: Date.now(),
              } satisfies DrawingQueuedMutation);
          });
          if (state === "pending") {
            await options.onChange?.();
            break;
          }
        }
        await options.onChange?.();
      }
    } finally {
      this.flushing = false;
    }
  }
  dispose() {
    this.disposed = true;
  }
}
