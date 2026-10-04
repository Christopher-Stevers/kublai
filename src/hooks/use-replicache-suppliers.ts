"use client";

import { tryGetMaterialListReplicache } from "~/lib/replicache-material-list";
import { createSharedReplicacheReader } from "~/hooks/use-shared-replicache";
import type { SupplierContact } from "~/lib/supplier-contacts";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";

export interface ReplicacheSupplier {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contacts?: SupplierContact[] | null;
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

const useSuppliers = createSharedReplicacheReader(async (tx) => {
      const entries = await tx
        .scan({ prefix: "supplier/" })
        .entries()
        .toArray();
      const result: ReplicacheSupplier[] = [];
      for (const [, value] of entries) {
        if (isSupplierRecord(value)) {
          result.push(value);
        }
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
}, [] as ReplicacheSupplier[]);

export function useReplicacheSuppliers({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const sandbox = useTutorialSandbox();
  const rep = enabled ? (sandbox?.material ?? tryGetMaterialListReplicache()) : null;
  return useSuppliers(rep);
}
