"use client";

import { useMemo } from "react";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
  requestMaterialListReplicacheSync,
  saveQuantityDurably,
} from "~/lib/replicache-material-list";

/** Keeps the normal controls inside their current workspace's data boundary. */
export function useWorkspaceMutations() {
  const sandbox = useTutorialSandbox();
  return useMemo(
    () => ({
      getReplicache: () => sandbox?.material ?? getMaterialListReplicache(),
      mutateAndSync: <T>(mutation: Promise<T>) =>
        sandbox ? mutation : mutateMaterialListAndSync(mutation),
      requestSync: (delayMs = 0, mode: "pull" | "push-pull" = "push-pull") => {
        if (!sandbox) requestMaterialListReplicacheSync(delayMs, mode);
      },
      saveQuantity: (input: Parameters<typeof saveQuantityDurably>[0]) =>
        sandbox
          ? sandbox.material.mutate.updateItemQuantity(input)
          : saveQuantityDurably(input),
    }),
    [sandbox],
  );
}
