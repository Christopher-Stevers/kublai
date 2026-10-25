"use client";
import { use, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { WifiOffIcon } from "lucide-react";
import { JobMaterialListsView } from "~/components/materialLists/JobMaterialListsView";
import { api } from "~/trpc/react";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { useReplicacheJobDetail } from "~/hooks/use-replicache-jobs";
import { useOnlineStatus } from "~/hooks/use-online-status";
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
  const isBrowserOnline = useOnlineStatus();

  useEffect(() => {
    setLastJobWorkspaceLocation({
      jobId,
      view: "material-lists",
      materialListId: null,
    });
  }, [jobId]);

  const jobDetail = useReplicacheJobDetail(jobId);
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
  const job = jobDetail?.job ?? serverJob ?? null;
  const materialLists = (jobDetail?.materialLists ?? serverMaterialLists)?.map(
    (list) => ({
      ...list,
      ...serverSendStatusByListId.get(list.id),
    }),
  );

  if (!job && !hasFetchedServerJob) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1].map((index) => (
              <Card key={index}>
                <CardHeader>
                  <Skeleton className="h-6 w-2/3" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-1/3" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">Job not found</p>
            <Button onClick={() => router.push("/jobs")}>
              Back to Jobs
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        {!isBrowserOnline && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
              <WifiOffIcon className="h-4 w-4" />
              Offline mode
            </div>
          </div>
        )}
        <JobMaterialListsView
          jobId={jobId}
          lists={materialLists}
          onOpen={(id) => router.push(`/jobs/material-lists/${id}`)}
        />
      </div>
    </div>
  );
}
