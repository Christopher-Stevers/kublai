"use client";

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
import { useOfflineJobsList } from "~/hooks/use-offline-jobs";

export function JobSelector() {
  const { data: jobs } = useOfflineJobsList(undefined);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <BriefcaseIcon className="h-4 w-4" />
          <span className="max-w-[200px] truncate">Select Job</span>
          <ChevronDownIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Local Jobs</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {jobs && jobs.length > 0 ? (
          jobs.map((job) => (
            <DropdownMenuItem key={job.id} disabled>
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
          <DropdownMenuItem disabled>No local jobs available</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
