"use client";

import { use } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import {
  MapPinIcon,
  PencilIcon,
  UserIcon,
  WifiOffIcon,
} from "lucide-react";
import { useState } from "react";
import { JobEditDialog } from "~/components/jobs/JobEditDialog";
import { JobWorkspaceOptions } from "~/components/jobs/JobWorkspaceOptions";
import { setLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";
import { useReplicacheJobDetail } from "~/hooks/use-replicache-jobs";
import { useOnlineStatus } from "~/hooks/use-online-status";

type JobLocationDisplay = {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

function formatLocationAddress(
  location: JobLocationDisplay | null | undefined,
) {
  if (!location) return null;

  const addressLine = [location.address1, location.address2]
    .filter(Boolean)
    .join(" ");
  const cityLine = [location.city, location.region, location.postalCode]
    .filter(Boolean)
    .join(", ");

  return (
    [addressLine, cityLine, location.country].filter(Boolean).join(" • ") ||
    null
  );
}

export default function JobOptionsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId: paramJobId } = use(params);
  const pathname = usePathname();
  const jobId =
    pathname.match(/^\/dashboard\/jobs\/([^/?#]+)/)?.[1] ?? paramJobId;
  const router = useRouter();
  const [showEditDialog, setShowEditDialog] = useState(false);
  const isBrowserOnline = useOnlineStatus();
  const { data: roleData } = api.user.getMyRole.useQuery(undefined, {
    enabled: isBrowserOnline,
  });
  const canOpenAssets = roleData?.permissions.tabAccess.assets === true;
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
  const job = jobDetail?.job ?? serverJob ?? null;
  const materialListCount =
    jobDetail?.materialLists.length ?? serverJob?.materialLists.length ?? 0;
  const jobLocationAddress = formatLocationAddress(job?.location);

  if (!job && !hasFetchedServerJob) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="space-y-3">
            <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-80 animate-pulse rounded bg-gray-200" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1].map((index) => (
              <Card key={index} className="animate-pulse">
                <CardHeader>
                  <div className="h-6 w-2/3 rounded bg-gray-200" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="h-4 w-1/2 rounded bg-gray-200" />
                    <div className="h-4 w-1/3 rounded bg-gray-200" />
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
            <Button onClick={() => router.push("/dashboard")}>
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

        <div className="mb-6">
          <div className="mb-2 flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
              {job.name}
            </h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEditDialog(true)}
              className="h-8 w-8 p-0"
              aria-label="Edit job"
            >
              <PencilIcon className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            {jobLocationAddress && (
              <div className="flex items-center gap-2">
                <MapPinIcon className="h-4 w-4" />
                <span>{jobLocationAddress}</span>
              </div>
            )}
            {job.foremanName && (
              <div className="flex items-center gap-2">
                <UserIcon className="h-4 w-4" />
                <span>{job.foremanName}</span>
              </div>
            )}
            {job.poNumber && (
              <div className="flex items-center gap-2">
                <span className="font-medium">PO#:</span>
                <span>{job.poNumber}</span>
              </div>
            )}
          </div>
        </div>

        <JobWorkspaceOptions
          materialListCount={materialListCount}
          onSelect={(optionId) => {
            setLastJobWorkspaceLocation({
              jobId: job.id,
              view: optionId,
              materialListId: null,
            });
            if (optionId === "material-lists") {
              router.push(`/dashboard/jobs/${job.id}/material-lists`);
            }
            if (optionId === "rooms") {
              router.push(`/dashboard/jobs/${job.id}/rooms`);
            }
          }}
          onTools={
            canOpenAssets
              ? () => router.push(`/dashboard/assets/where/job/${job.id}`)
              : undefined
          }
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
