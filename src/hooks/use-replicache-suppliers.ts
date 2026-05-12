"use client";

import { useCallback } from "react";
import { getMaterialListReplicache } from "~/lib/replicache-material-list";
import { useReplicacheSubscribe } from "~/hooks/use-replicache-subscribe";

export interface ReplicacheSupplier {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  orderingNotes: string | null;
  locationId: string | null;
  createdAt: string;
  pendingSync?: boolean;
}

function isSupplierRecord(value: unknown): value is ReplicacheSupplier {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "id" in value &&
    "name" in value
  );
}

export function useReplicacheSuppliers() {
  const rep = getMaterialListReplicache();

  const suppliers = useReplicacheSubscribe(
    rep,
    useCallback(async (tx) => {
      const entries = await tx.scan({ prefix: "supplier/" }).entries().toArray();
      const result: ReplicacheSupplier[] = [];
      for (const [, value] of entries) {
        if (isSupplierRecord(value)) {
          result.push(value);
        }
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    }, []),
    { default: [] as ReplicacheSupplier[] },
  );

  return suppliers;
}
