"use client";

import { MapPinIcon, PencilIcon, UserIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  formatLocationAddress,
  type JobLocationDisplay,
} from "~/lib/location-address";

/** Same job heading in direct routes, the offline host, and the tutorial. */
export function JobOverviewHeading({
  job,
  onEdit,
}: {
  job: {
    name: string;
    location?: JobLocationDisplay | null;
    foremanName?: string | null;
    poNumber?: string | null;
  };
  onEdit: () => void;
}) {
  const jobLocationAddress = formatLocationAddress(job.location);
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-foreground text-2xl font-bold sm:text-3xl">
          {job.name}
        </h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit()}
          className="h-8 w-8 p-0"
          aria-label="Edit job"
        >
          <PencilIcon className="h-4 w-4" />
        </Button>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-4 text-sm">
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
  );
}
