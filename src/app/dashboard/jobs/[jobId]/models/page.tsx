"use client";
import { use, useEffect } from "react";
import { usePathname } from "next/navigation";
import { DeferredJobModelsView } from "~/components/models/DeferredJobModelsView";
import { setLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";
export default function JobModelsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId: paramId } = use(params);
  const pathname = usePathname();
  const jobId = (/^\/dashboard\/jobs\/([^/?#]+)/.exec(pathname))?.[1] ?? paramId;
  useEffect(
    () =>
      setLastJobWorkspaceLocation({
        jobId,
        view: "models",
        materialListId: null,
      }),
    [jobId],
  );
  return <DeferredJobModelsView jobId={jobId} />;
}
