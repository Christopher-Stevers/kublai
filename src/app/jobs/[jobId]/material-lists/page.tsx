"use client";
import { JobOfflineNotice } from "~/components/jobs/JobOfflineNotice";
import { use, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { JobMaterialListsView } from "~/components/materialLists/JobMaterialListsView";
import { useJobPageData } from "~/hooks/use-job-page-data";
import { JobPageState } from "~/components/jobs/JobPageState";
import { setLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId: paramJobId } = use(params);
  const pathname = usePathname();
  const jobId =
    pathname.match(/^\/jobs\/([^/?#]+)/)?.[1] ?? paramJobId;
  const router = useRouter();
  const { isBrowserOnline, jobDetail, serverJob, hasFetchedServerJob, job } = useJobPageData(jobId);

  useEffect(() => {
    setLastJobWorkspaceLocation({
      jobId,
      view: "material-lists",
      materialListId: null,
    });
  }, [jobId]);


  const serverMaterialLists =
    serverJob?.materialLists.map((list) => ({
      ...list,
      jobId,
      quoteId: list.quoteId,
      updatedAt: list.createdAt,
      itemCount: 0,
      materialTotal: 0,
      contributors: [],
    })) ?? null;
  const serverSendStatusByListId = new Map(
    serverJob?.materialLists.map((list) => [
      list.id,
      {
        orderNumbers: list.orderNumbers,
        orderStatuses: list.orderStatuses,
        overallProgress: list.overallProgress,
        sentSupplierCount: list.sentSupplierCount,
        totalSupplierCount: list.totalSupplierCount,
        verifiedSupplierCount: list.verifiedSupplierCount,
      },
    ]) ?? [],
  );
  const materialLists = (jobDetail?.materialLists ?? serverMaterialLists)?.map(
    (list) => ({
      ...list,
      ...serverSendStatusByListId.get(list.id),
    }),
  );

  if (!job) return <JobPageState loading={!hasFetchedServerJob} />;

  return (
    <div className="px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        {!isBrowserOnline && <JobOfflineNotice />}
        <JobMaterialListsView
          jobId={jobId}
          lists={materialLists}
          onOpen={(id) => router.push(`/jobs/material-lists/${id}`)}
        />
      </div>
    </div>
  );
}
