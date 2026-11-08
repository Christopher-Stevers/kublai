import { notFound } from "next/navigation";
import { devFeaturesEnabled } from "~/server/dev-features";

export function DevFeatureGate({ children }: { children: React.ReactNode }) {
  if (!devFeaturesEnabled()) notFound();
  return children;
}
