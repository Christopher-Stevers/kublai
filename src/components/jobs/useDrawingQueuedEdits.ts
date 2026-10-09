"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DrawingOfflineQueue,
  type DrawingQueuedMutation,
} from "~/lib/drawing-offline-queue";
import type { DrawingEntity, DrawingSave } from "~/lib/drawing-workspace";

/** Owns an account-bound durable queue. Screen changes never discard unsynced work. */
export function useDrawingQueuedEdits(options: {
  accountKey: string | null;
  userId: string | null;
  jobId: string;
  sheetId: string;
  online: boolean;
  save: (input: DrawingSave) => Promise<DrawingEntity>;
  onSaved: (entity: DrawingEntity) => void;
  onError: (error: unknown) => void;
}) {
  const callbacks = useRef(options);
  useLayoutEffect(() => {
    callbacks.current = options;
  });
  const queue = useRef<DrawingOfflineQueue | null>(null);
  const scope = `${options.accountKey ?? ""}:${options.jobId}:${options.sheetId}`;
  const [state, setState] = useState<{
    scope: string;
    records: DrawingQueuedMutation[];
  } | null>(null);
  const ready = state?.scope === scope;
  const records = ready ? state.records : [];
  const reload = useCallback(async () => {
    const active = queue.current;
    if (!active) return;
    const next = await active.list({
      jobId: options.jobId,
      sheetId: options.sheetId,
    });
    if (queue.current === active) setState({ scope, records: next });
  }, [options.jobId, options.sheetId, scope]);
  const sync = useCallback(async () => {
    const active = queue.current;
    if (!active || !callbacks.current.online) return;
    try {
      await active.flush({
        jobId: options.jobId,
        sheetId: options.sheetId,
        save: (input) => callbacks.current.save(input),
        onChange: reload,
        onSaved: (entity) => {
          if (queue.current === active) callbacks.current.onSaved(entity);
        },
      });
      await reload();
    } catch (error) {
      if (queue.current === active) callbacks.current.onError(error);
    }
  }, [options.jobId, options.sheetId, reload]);
  useEffect(() => {
    if (!options.accountKey || !options.userId) return;
    let active: DrawingOfflineQueue;
    try {
      active = new DrawingOfflineQueue(options.accountKey, options.userId);
    } catch (error) {
      callbacks.current.onError(error);
      return;
    }
    queue.current = active;
    void reload()
      .then(() => {
        if (queue.current !== active) return;
        void sync();
      })
      .catch((error) => {
        if (queue.current === active) callbacks.current.onError(error);
      });
    return () => {
      if (queue.current === active) queue.current = null;
      active.dispose();
    };
  }, [options.accountKey, options.userId, reload, sync]);
  useEffect(() => {
    if (!options.online) return;
    void sync();
    const refresh = () => {
      void reload()
        .then(sync)
        .catch((error) => callbacks.current.onError(error));
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [options.online, reload, sync]);
  const enqueue = async (
    input: DrawingSave,
    baseEntity?: DrawingEntity,
    authorName?: string,
  ) => {
    const active = queue.current;
    if (!active)
      throw Error(
        "Offline edit storage is unavailable. Reconnect before saving.",
      );
    const record = await active.enqueue({
      jobId: options.jobId,
      input,
      baseEntity,
      authorName,
    });
    await reload();
    void sync();
    return record;
  };
  const discard = async (operationId: string) => {
    await queue.current?.discard(operationId);
    await reload();
  };
  const retry = async (operationId: string) => {
    await queue.current?.retry(operationId);
    await reload();
    await sync();
  };
  return { ready, records, enqueue, discard, retry, sync };
}
