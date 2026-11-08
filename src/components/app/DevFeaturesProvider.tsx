"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useDevPreference } from "~/lib/dev-preference";

const DevFeatures = createContext({ available: false, enabled: false });
export function DevFeaturesProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const preference = useDevPreference();
  return <DevFeatures.Provider value={{ available: enabled, enabled: enabled && preference }}>{children}</DevFeatures.Provider>;
}
export const useDevFeatures = () => useContext(DevFeatures).enabled;
export const useDevFeaturesAvailable = () => useContext(DevFeatures).available;
