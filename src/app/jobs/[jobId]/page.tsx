"use client";
import { JobOfflineNotice } from "~/components/jobs/JobOfflineNotice";
import { JobOverviewHeading } from "~/components/jobs/JobOverviewHeading";
import { useScrollToTop } from "~/hooks/use-remembered-scroll";

import { use } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { useState } from "react";
import { JobEditDialog } from "~/components/jobs/JobEditDialog";
import { JobWorkspaceOptions } from "~/components/jobs/JobWorkspaceOptions";
import { setLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";
import { useJobPageData } from "~/hooks/use-job-page-data";
import { JobPageState } from "~/components/jobs/JobPageState";
import { useJobRoomCount } from "~/hooks/use-job-room-count";



export default function JobOptionsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId: paramJobId } = use(params);
  const pathname = usePathname();
  const jobId =
    pathname.match(/^\/jobs\/([^/?#]+)/)?.[1] ?? paramJobId;
  useScrollToTop(jobId);
  const router = useRouter();
  const [showEditDialog, setShowEditDialog] = useState(false);
  const { isBrowserOnline, jobDetail, serverJob, hasFetchedServerJob, job } = useJobPageData(jobId);
  const { data: chatOverview } = api.chat.getOverview.useQuery({ jobId }, {
    enabled: isBrowserOnline, refetchInterval: 30_000, refetchIntervalInBackground: false,
  });
  const roomCount = useJobRoomCount(jobId);

  const materialListCount =
    jobDetail?.materialLists.length ?? serverJob?.materialLists.length ?? 0;

  if (!job) return <JobPageState loading={!hasFetchedServerJob} />;

  return (
    <div className="px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        {!isBrowserOnline && <JobOfflineNotice />}

        <JobOverviewHeading job={job} onEdit={() => setShowEditDialog(true)} />

        <JobWorkspaceOptions
          jobId={jobId}
          materialListCount={materialListCount}
          roomCount={roomCount.count}
          roomCountLoading={roomCount.loading}
          chatUnreadCount={chatOverview?.unreadCount}
          onSelect={(optionId) => {
            setLastJobWorkspaceLocation({
              jobId: job.id,
              view: optionId,
              materialListId: null,
            });
            if (optionId === "material-lists") {
              router.push(`/jobs/${job.id}/material-lists`);
            }
            if (optionId === "chat") {
              router.push(`/jobs/${job.id}/chat`);
            }
            if (optionId === "models") {
              router.push(`/jobs/${job.id}/models`);
            }
            if (optionId === "drawings") {
              router.push(`/jobs/${job.id}/drawings`);
            }
            if (optionId === "documents") {
              router.push(`/jobs/${job.id}/documents`);
            }
            if (optionId === "systems") {
              router.push(`/jobs/${job.id}/systems`);
            }
            if (optionId === "rooms") {
              router.push(`/jobs/${job.id}/rooms`);
            }
          }}
        />

        <JobEditDialog
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          jobId={jobId}
          initialName={job.name}
          initialLocationId={job.locationId}
          initialForemanName={job.foremanName ?? null}
          initialPoNumber={job.poNumber ?? null}
        />
      </div>
    </div>
  );
}
