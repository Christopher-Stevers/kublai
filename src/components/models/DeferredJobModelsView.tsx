"use client";
import { useDevFeatures } from "~/components/app/DevFeaturesProvider";
import dynamic from "next/dynamic";
const LazyJobModelsView = dynamic(
  () => import("./JobModelsView").then((m) => m.JobModelsView),
  {
    ssr: false,
    loading: () => (
      <div className="text-muted-foreground p-8 text-sm" role="status">
        Opening model workspace…
      </div>
    ),
  },
);

export function DeferredJobModelsView({ jobId }: { jobId: string }) {
  return useDevFeatures() ? <LazyJobModelsView jobId={jobId} /> : null;
}
