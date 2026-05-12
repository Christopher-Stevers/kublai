"use client";

import { useEffect } from "react";

import {
  closeMaterialListReplicache,
  getMaterialListReplicache,
} from "~/lib/replicache-material-list";

export function ReplicacheSyncBootstrap() {
  useEffect(() => {
    const replicache = getMaterialListReplicache();
    void replicache.pull({ now: true });

    return () => {
      void closeMaterialListReplicache();
    };
  }, []);

  return null;
}
