"use client";

import { useEffect } from "react";
import { warmDeferredFeatures } from "~/components/app/DeferredFeatures";

import {
  closeMaterialListReplicache,
  requestMaterialListReplicachePull,
  requestMaterialListReplicacheSync,
  tryGetMaterialListReplicache,
} from "~/lib/replicache-material-list";
import {
  closeCatalogueReplicache,
  requestCatalogueReplicachePull,
  tryGetCatalogueReplicache,
} from "~/lib/replicache-catalogue";
import { clearLegacyOfflineCatalogueSnapshot } from "~/lib/offline-catalogue";

type ReplicachePokeEvent = {
  sourceClientGroupId?: string | null;
};

export function ReplicacheSyncBootstrap() {
  useEffect(() => {
    const replicache = tryGetMaterialListReplicache();
    if (!replicache) return;

    clearLegacyOfflineCatalogueSnapshot();
    warmDeferredFeatures();
    // Replicache pulls when constructed. Consumers that need the catalog open it
    // immediately; other routes warm it after their initial render.
    const catalogueWarmup = setTimeout(() => tryGetCatalogueReplicache(), 4000);
    const events = new EventSource("/api/material-lists/events");
    let clientGroupId: string | null = null;
    void replicache.clientGroupID.then((id) => {
      clientGroupId = id;
    });

    const syncOnOnline = () => {
      warmDeferredFeatures();
      requestMaterialListReplicacheSync(0, "push-pull");
      requestCatalogueReplicachePull(0);
    };
    const syncOnVisible = () => {
      if (document.visibilityState === "visible") {
        requestMaterialListReplicachePull(0);
      }
    };
    const syncOnPoke = (event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const payload = JSON.parse(message.data) as ReplicachePokeEvent;
        if (
          payload.sourceClientGroupId &&
          payload.sourceClientGroupId === clientGroupId
        ) {
          return;
        }
      } catch {
        // If a legacy event is malformed, pull anyway. Freshness beats silence.
      }
      requestMaterialListReplicachePull(0);
    };
    const syncOnLegacyMaterialListEvent = () =>
      requestMaterialListReplicachePull(0);
    const notifyCatalogueUpdated = () => {
      requestCatalogueReplicachePull(0);
    };

    window.addEventListener("online", syncOnOnline);
    document.addEventListener("visibilitychange", syncOnVisible);
    events.addEventListener("replicache-poke", syncOnPoke);
    events.addEventListener(
      "material-list-updated",
      syncOnLegacyMaterialListEvent,
    );
    events.addEventListener("catalogue-updated", notifyCatalogueUpdated);
    events.onerror = () => {
      // EventSource auto-reconnects. Kick a pull so reconnect gaps don't leave
      // the current tab stale until the next poll.
      requestMaterialListReplicachePull(1_000);
    };

    return () => {
      clearTimeout(catalogueWarmup);
      window.removeEventListener("online", syncOnOnline);
      document.removeEventListener("visibilitychange", syncOnVisible);
      events.removeEventListener("replicache-poke", syncOnPoke);
      events.removeEventListener(
        "material-list-updated",
        syncOnLegacyMaterialListEvent,
      );
      events.removeEventListener("catalogue-updated", notifyCatalogueUpdated);
      events.close();
      void closeMaterialListReplicache();
      void closeCatalogueReplicache();
    };
  }, []);

  return null;
}
