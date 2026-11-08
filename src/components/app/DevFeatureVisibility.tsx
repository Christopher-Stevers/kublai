"use client";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useDevFeatures } from "./DevFeaturesProvider";

export function DevFeatureVisibility({ children }: { children: ReactNode }) {
  const enabled = useDevFeatures();
  const router = useRouter();
  useEffect(() => {
    if (!enabled) router.replace("/jobs");
  }, [enabled, router]);
  return enabled ? children : null;
}
