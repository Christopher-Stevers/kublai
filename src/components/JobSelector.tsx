"use client";

import { api } from "~/trpc/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { BriefcaseIcon, ChevronDownIcon } from "lucide-react";

export function JobSelector() {
  const utils = api.useUtils();
  const { data: currentJob } = api.job.getCurrentJob.useQuery();
  const { data: jobs } = api.job.listJobs.useQuery();
  const setCurrentJob = api.job.setCurrentJob.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.job.getCurrentJob.cancel();

      // Snapshot previous value
      const previousCurrentJob = utils.job.getCurrentJob.getData();

      // Optimistically update current job
      if (variables.jobId) {
        const selectedJob = jobs?.find((j) => j.id === variables.jobId);
        if (selectedJob) {
          utils.job.getCurrentJob.setData(undefined, {
            id: selectedJob.id,
            name: selectedJob.name,
            locationId: selectedJob.locationId,
            status: selectedJob.status,
          });
        }
      } else {
        utils.job.getCurrentJob.setData(undefined, null);
      }

      return { previousCurrentJob };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousCurrentJob !== undefined) {
        utils.job.getCurrentJob.setData(undefined, context.previousCurrentJob);
      }
    },
    onSettled: () => {
      void utils.job.getCurrentJob.invalidate();
      void utils.materialList.listMaterialLists.invalidate();
    },
  });

  const handleJobSelect = (jobId: string) => {
    setCurrentJob.mutate({ jobId });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <BriefcaseIcon className="h-4 w-4" />
          <span className="max-w-[200px] truncate">
            {currentJob?.name ?? "Select Job"}
          </span>
          <ChevronDownIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Select Job</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {jobs && jobs.length > 0 ? (
          jobs.map((job) => (
            <DropdownMenuItem
              key={job.id}
              onClick={() => handleJobSelect(job.id)}
              className={
                currentJob?.id === job.id ? "bg-gray-100 font-medium" : ""
              }
            >
              <div className="flex flex-col">
                <span>{job.name}</span>
                {job.location && (
                  <span className="text-xs text-muted-foreground">
                    {job.location.name}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>No jobs available</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

