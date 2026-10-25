"use client";
import { api } from "~/trpc/react";
import { useReplicacheJobDetail } from "~/hooks/use-replicache-jobs";
import { useOnlineStatus } from "~/hooks/use-online-status";

/** Local data remains available offline while the server refreshes online. */
export function useJobPageData(jobId: string, includeItems = false) {
  const isBrowserOnline = useOnlineStatus();
  const jobDetail = useReplicacheJobDetail(jobId, includeItems);
  const { data: serverJob, isFetched: hasFetchedServerJob } =
    api.job.getJob.useQuery(
      { jobId },
      {
        enabled: isBrowserOnline,
        networkMode: "always",
        refetchOnMount: true,
        refetchOnWindowFocus: false,
      },
    );
  return {
    isBrowserOnline,
    jobDetail,
    serverJob,
    hasFetchedServerJob,
    job: jobDetail?.job ?? serverJob ?? null,
  };
}
