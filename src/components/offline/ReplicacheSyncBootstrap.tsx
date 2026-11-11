"use client";

import { useEmployeeSimulation } from "~/components/simulation/SimulationProvider";
import { liveAccountScope } from "~/lib/live-protocol";
import { bindLiveAccount, subscribeLiveEvents } from "~/lib/live-client";
import { useEffect } from "react";
import { warmDeferredFeatures } from "~/components/app/DeferredFeatures";
import { scheduleBackgroundWork } from "~/lib/background-work";

import {
  closeMaterialListReplicache,
  initializeQuantityJournal,
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

export function ReplicacheSyncBootstrap({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  const simulation = useEmployeeSimulation();
  useEffect(() => {
    const releaseAccount = bindLiveAccount(liveAccountScope(organizationId, userId, simulation?.id));
    const replicache = tryGetMaterialListReplicache();
    if (!replicache) return releaseAccount;
    try {
      initializeQuantityJournal(userId, organizationId);
    } catch (error) {
      console.error("Offline quantity storage could not initialize", error);
    }

    clearLegacyOfflineCatalogueSnapshot();
    warmDeferredFeatures();
    // Replicache pulls when constructed. Consumers that need the catalog open it
    // immediately; other routes warm it after their initial render.
    const cancelCatalogueWarmup = scheduleBackgroundWork("catalogue-sync", async () => { tryGetCatalogueReplicache(); });
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
    const unsubscribeLive = subscribeLiveEvents({}, {
      hint: hint => {
        if (hint.topic === "catalogue") requestCatalogueReplicachePull(0);
        if (hint.topic === "material" || (hint.topic === "replicache" &&
            (!hint.sourceClientGroupId || hint.sourceClientGroupId !== clientGroupId)))
          requestMaterialListReplicachePull(0);
      },
      catchUp: () => {
        requestMaterialListReplicachePull(0);
        requestCatalogueReplicachePull(0);
      },
    });

    window.addEventListener("online", syncOnOnline);
    document.addEventListener("visibilitychange", syncOnVisible);

    return () => {
      cancelCatalogueWarmup();
      window.removeEventListener("online", syncOnOnline);
      document.removeEventListener("visibilitychange", syncOnVisible);
      unsubscribeLive();
      releaseAccount();
      void closeMaterialListReplicache();
      void closeCatalogueReplicache();
    };
  }, [userId, organizationId, simulation?.id]);

  return null;
}
