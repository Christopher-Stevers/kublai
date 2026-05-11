"use client";

import { useEffect } from "react";

import { OFFLINE_MATERIAL_LIST_SYNC_EVENT } from "~/lib/offline-material-list-mutations";
import { addSyncDebugEvent } from "~/lib/offline-sync-debug-timeline";

type MaterialListRealtimeEvent = {
  materialListId: string;
  type: "created" | "updated" | "deleted";
  version: number;
  changedAt: string;
};

export function useMaterialListRealtimeEvents(materialListId?: string) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.EventSource) return;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByHook = false;
    let source: EventSource | null = null;

    const connect = () => {
      source?.close();
      const url = materialListId
        ? `/api/material-lists/${encodeURIComponent(materialListId)}/events`
        : "/api/material-lists/events";
      source = new EventSource(url);

      source.addEventListener("material-list-updated", (message) => {
        let event: MaterialListRealtimeEvent | null = null;
        try {
          event = JSON.parse(message.data) as MaterialListRealtimeEvent;
        } catch {
          return;
        }

        addSyncDebugEvent({
          phase: "wake",
          status: "info",
          message: "Another device changed this material list; waking sync",
          details: event,
        });

        window.dispatchEvent(
          new CustomEvent(OFFLINE_MATERIAL_LIST_SYNC_EVENT, {
            detail: {
              serverChanged: true,
              materialListId: event.materialListId,
              type: event.type,
              version: event.version,
            },
          }),
        );
      });

      source.onerror = () => {
        source?.close();
        if (closedByHook) return;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 5_000);
      };
    };

    connect();

    return () => {
      closedByHook = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [materialListId]);
}
