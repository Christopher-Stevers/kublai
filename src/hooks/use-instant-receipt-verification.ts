"use client";

import { useEffect, useRef, useState } from "react";
import { api, type RouterInputs } from "~/trpc/react";
import { useInstantMutation } from "./use-instant-mutation";
import { requestMaterialListReplicacheSync } from "~/lib/replicache-material-list";

type Input = RouterInputs["materialList"]["updateOrderItemVerification"];
export type ReceiptSnapshot = {
  orderItemId: string;
  receivedQuantity: string | number | null;
  verificationStatus: string | null;
};
type Preview = Input & { saving: boolean; token: symbol; sourceValue: string };
const savedValue = (snapshot?: ReceiptSnapshot) => JSON.stringify([
  Number(snapshot?.receivedQuantity ?? 0), snapshot?.verificationStatus ?? null,
]);

/** The control's immediate receipt preview is ephemeral. The server remains the
 * receipt authority; only an accepted value bridges the gap until sync catches
 * up. No Replicache row is changed and no receipt is queued by this helper. */
export function useInstantReceiptVerification(snapshots: readonly ReceiptSnapshot[]) {
  const utils = api.useUtils();
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [resetVersions, setResetVersions] = useState<Record<string, number>>({});
  const pending = useRef(new Set<string>());
  const latestSnapshots = useRef(new Map(snapshots.map(row => [row.orderItemId, row])));
  useEffect(() => {
    const saved = new Map(snapshots.map(row => [row.orderItemId, row]));
    latestSnapshots.current = saved;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      setPreviews(current => {
        let next = current;
        for (const snapshot of saved.values()) {
          const preview = next[snapshot.orderItemId];
          if (preview && !preview.saving && (
              (Number(snapshot.receivedQuantity ?? 0) === preview.receivedQuantity &&
                snapshot.verificationStatus === preview.verificationStatus) ||
              savedValue(snapshot) !== preview.sourceValue)) {
            if (next === current) next = { ...current };
            delete next[snapshot.orderItemId];
          }
        }
        return next;
      });
    });
    return () => { disposed = true; };
  }, [snapshots, previews]);
  const mutation = useInstantMutation({
    mutationKey: [["materialList", "updateOrderItemVerification"]],
    mutationFn: async (input: Input) => {
      const result = await utils.client.materialList.updateOrderItemVerification.mutate(input);
      if (!result) throw new Error("This order line is no longer available.");
      return result;
    },
    optimistic: (input) => {
      const id = input.orderItemId;
      if (pending.current.has(id)) throw new Error("This receipt change is still being saved.");
      pending.current.add(id);
      const token = Symbol();
      const previous = previews[id];
      setPreviews(current => ({ ...current, [id]: {
        ...input, saving: true, token,
        sourceValue: savedValue(latestSnapshots.current.get(id)),
      } }));
      return {
        rollback: () => setPreviews(current => {
          if (current[id]?.token !== token) return current;
          const next = { ...current };
          if (previous) next[id] = previous;
          else delete next[id];
          return next;
        }),
        commit: () => {
          setPreviews(current => current[id]?.token === token
            ? { ...current, [id]: {
              ...current[id], saving: false,
            } }
            : current);
          requestMaterialListReplicacheSync(0, "pull");
        },
        finish: () => { pending.current.delete(id); },
      };
    },
    onError: (_error, input) => {
      // A control can edit locally before connectivity is checked. Reset even
      // when preparation failed before an optimistic transaction was created.
      setResetVersions(current => ({ ...current, [input.orderItemId]: (current[input.orderItemId] ?? 0) + 1 }));
    },
    onSettled: () => {
      void utils.materialList.getOrderById.invalidate();
      void utils.materialList.getOrdersForMaterialList.invalidate();
      void utils.materialList.listOrders.invalidate();
    },
    errorMessage: "This receipt change could not be saved. The saved quantity has been restored.",
  });
  return {
    ...mutation,
    isPending: Object.values(previews).some(value => value.saving),
    hasPending: () => pending.current.size > 0,
    previews,
    resetVersions,
  };
}
