"use client";

import { createContext, useContext } from "react";
import type { Replicache } from "replicache";
import type { MaterialListReplicacheMutators } from "~/lib/replicache-material-list";

export type TutorialSandbox = {
  userId: string;
  material: Replicache<MaterialListReplicacheMutators>;
  catalogue: Replicache;
  runId: string;
};

export const TutorialSandboxContext = createContext<TutorialSandbox | null>(null);
export const useTutorialSandbox = () => useContext(TutorialSandboxContext);
