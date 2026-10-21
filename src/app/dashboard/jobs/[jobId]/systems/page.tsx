"use client";

import { use, useEffect } from "react";
import { usePathname } from "next/navigation";
import { JobSystemsView } from "~/components/app/DeferredFeatures";
import { setLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";

export default function JobSystemsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId: parameter } = use(params);
  const pathname = usePathname();
  const jobId =
    /^\/dashboard\/jobs\/([^/?#]+)/.exec(pathname)?.[1] ?? parameter;
  useEffect(() => {
    setLastJobWorkspaceLocation({
      jobId,
      view: "systems",
      materialListId: null,
    });
  }, [jobId]);
  return (
    <div className="px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <JobSystemsView key={jobId} jobId={jobId} />
      </div>
    </div>
  );
}
