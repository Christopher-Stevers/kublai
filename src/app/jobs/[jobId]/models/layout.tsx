import { notFound } from "next/navigation";
import { devFeaturesEnabled } from "~/server/dev-features";

export default function ModelsLayout({ children }: { children: React.ReactNode }) {
  if (!devFeaturesEnabled()) notFound();
  return children;
}
