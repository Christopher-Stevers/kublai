"use client";

import Link from "next/link";
import { ChevronRightIcon, ReceiptIcon, WifiOffIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { formatCents } from "~/lib/draws";
import { api } from "~/trpc/react";

import { DrawStatusBadge } from "./DrawStatusBadge";

export function DrawsJobsList() {
  const isOnline = useOnlineStatus();
  const { data: jobs, isLoading, error } = api.draws.listJobs.useQuery(
    undefined,
    { enabled: isOnline },
  );

  const header = (
    <div>
      <h2 className="text-xl font-bold sm:text-2xl">Draws</h2>
      <p className="text-muted-foreground mt-1 text-sm sm:text-base">
        Progress billing by job, with a schedule of values for each
      </p>
    </div>
  );

  if (!isOnline) {
    return (
      <div className="space-y-4">
        {header}
        <p className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
          <WifiOffIcon className="h-3 w-3" /> Reconnect to view draws.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading draws...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {header}
        <p className="text-destructive text-sm">{error.message}</p>
      </div>
    );
  }

  if (!jobs || jobs.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-lg border border-dashed p-12 text-center">
          <ReceiptIcon className="text-muted-foreground mx-auto h-12 w-12" />
          <h3 className="mt-4 text-lg font-semibold">No jobs yet</h3>
          <p className="text-muted-foreground mt-2">
            Create a job from the dashboard, then set up its draws here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      <div className="rounded-lg border bg-white">
        <div className="divide-y">
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={`/dashboard/draws/${job.id}`}
              className="flex items-center gap-3 p-4 hover:bg-gray-50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-semibold sm:text-lg">
                    {job.name}
                  </h3>
                  {job.latestDrawNumber !== null && job.latestDrawStatus ? (
                    <DrawStatusBadge
                      status={job.latestDrawStatus}
                      label={`Draw #${job.latestDrawNumber}`}
                    />
                  ) : job.lineCount === 0 ? (
                    <Badge variant="outline">Not set up</Badge>
                  ) : null}
                </div>
                <div className="text-muted-foreground mt-1 flex flex-col gap-1 text-xs sm:flex-row sm:flex-wrap sm:gap-4 sm:text-sm">
                  <span>
                    Contract:{" "}
                    <span className="text-foreground font-medium">
                      {formatCents(job.contractSumCents)}
                    </span>
                  </span>
                  <span>
                    Billed to date: {formatCents(job.billedToDateCents)} (
                    {job.percentComplete.toFixed(1)}%)
                  </span>
                  <span>
                    {job.lineCount} line item{job.lineCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <ChevronRightIcon className="text-muted-foreground h-5 w-5 shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
