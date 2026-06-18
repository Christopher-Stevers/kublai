"use client";

import { useEffect } from "react";

import {
  closeMaterialListReplicache,
  requestMaterialListReplicachePull,
  requestMaterialListReplicacheSync,
  tryGetMaterialListReplicache,
} from "~/lib/replicache-material-list";
import { CATALOGUE_SERVER_UPDATED_EVENT } from "~/lib/offline-catalogue";

type ReplicachePokeEvent = {
  sourceClientGroupId?: string | null;
};

export function ReplicacheSyncBootstrap() {
  useEffect(() => {
    const replicache = tryGetMaterialListReplicache();
    if (!replicache) return;

    void replicache.pull({ now: true });
    const events = new EventSource("/api/material-lists/events");
    let clientGroupId: string | null = null;
    void replicache.clientGroupID.then((id) => {
      clientGroupId = id;
    });

    const syncOnOnline = () => requestMaterialListReplicacheSync(0, "push-pull");
    const syncOnVisible = () => {
      if (document.visibilityState === "visible") {
        requestMaterialListReplicachePull(0);
      }
    };
    const syncOnPoke = (event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const payload = JSON.parse(message.data) as ReplicachePokeEvent;
        if (payload.sourceClientGroupId && payload.sourceClientGroupId === clientGroupId) {
          return;
        }
      } catch {
        // If a legacy event is malformed, pull anyway. Freshness beats silence.
      }
      requestMaterialListReplicachePull(0);
    };
    const syncOnLegacyMaterialListEvent = () => requestMaterialListReplicachePull(0);
    const notifyCatalogueUpdated = () => {
      window.dispatchEvent(new Event(CATALOGUE_SERVER_UPDATED_EVENT));
    };

    window.addEventListener("online", syncOnOnline);
    document.addEventListener("visibilitychange", syncOnVisible);
    events.addEventListener("replicache-poke", syncOnPoke);
    events.addEventListener("material-list-updated", syncOnLegacyMaterialListEvent);
    events.addEventListener("catalogue-updated", notifyCatalogueUpdated);
    events.onerror = () => {
      // EventSource auto-reconnects. Kick a pull so reconnect gaps don't leave
      // the current tab stale until the next poll.
      requestMaterialListReplicachePull(1_000);
    };

    return () => {
      window.removeEventListener("online", syncOnOnline);
      document.removeEventListener("visibilitychange", syncOnVisible);
      events.removeEventListener("replicache-poke", syncOnPoke);
      events.removeEventListener("material-list-updated", syncOnLegacyMaterialListEvent);
      events.removeEventListener("catalogue-updated", notifyCatalogueUpdated);
      events.close();
      void closeMaterialListReplicache();
    };
  }, []);

  return null;
}
