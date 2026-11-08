"use client";
import { createContext, useContext, type ReactNode } from "react";

const DevFeatures = createContext(false);
export function DevFeaturesProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <DevFeatures.Provider value={enabled}>{children}</DevFeatures.Provider>;
}
export const useDevFeatures = () => useContext(DevFeatures);
