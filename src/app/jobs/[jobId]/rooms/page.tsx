"use client";
import { JobOfflineNotice } from "~/components/jobs/JobOfflineNotice";
import { JobRoomsView } from "~/components/app/DeferredFeatures";


import { use, useEffect } from "react";
import { usePathname } from "next/navigation";
import { setLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";
import { useJobPageData } from "~/hooks/use-job-page-data";
import { JobPageState } from "~/components/jobs/JobPageState";

export default function JobRoomsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId: paramJobId } = use(params);
  const pathname = usePathname();
  const jobId =
    pathname.match(/^\/jobs\/([^/?#]+)/)?.[1] ?? paramJobId;
  const { isBrowserOnline, jobDetail, serverJob, hasFetchedServerJob, job } = useJobPageData(jobId);


  useEffect(() => {
    setLastJobWorkspaceLocation({
      jobId,
      view: "rooms",
      materialListId: null,
    });
  }, [jobId]);

  if (!job) return <JobPageState loading={!hasFetchedServerJob} />;

  return (
    <div className="px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        {!isBrowserOnline && <JobOfflineNotice />}

        <JobRoomsView jobId={job.id} />
      </div>
    </div>
  );
}
