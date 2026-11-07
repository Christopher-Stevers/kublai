"use client";
import dynamic from "next/dynamic";
export const DeferredJobModelsView = dynamic(
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
