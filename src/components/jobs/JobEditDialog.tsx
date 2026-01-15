"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { LocationSelector } from "~/components/ui/LocationSelector";

interface JobEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  initialName?: string | null;
  initialLocationId?: string | null;
  initialJobNumber?: string | null;
}

export function JobEditDialog({
  open,
  onOpenChange,
  jobId,
  initialName,
  initialLocationId,
  initialJobNumber,
}: JobEditDialogProps) {
  const [jobName, setJobName] = useState(initialName || "");
  const [locationId, setLocationId] = useState<string | null>(
    initialLocationId ?? null,
  );
  const [jobNumber, setJobNumber] = useState(initialJobNumber || "");

  // Update local state when initial values change
  useEffect(() => {
    setJobName(initialName || "");
    setLocationId(initialLocationId ?? null);
    setJobNumber(initialJobNumber || "");
  }, [initialName, initialLocationId, initialJobNumber, open]);

  const utils = api.useUtils();
  const updateJob = api.job.updateJob.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.job.getJob.cancel({ jobId });
      await utils.job.listJobs.cancel();

      // Snapshot previous values
      const previousJob = utils.job.getJob.getData({ jobId });
      const previousJobsList = utils.job.listJobs.getData();

      // Optimistically update job detail
      utils.job.getJob.setData({ jobId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          name: variables.name ?? old.name,
          locationId: variables.locationId ?? old.locationId,
        };
      });

      // Optimistically update job in list
      utils.job.listJobs.setData(undefined, (old) => {
        if (!old) return old;
        return old.map((job) =>
          job.id === jobId
            ? {
                ...job,
                name: variables.name ?? job.name,
                locationId: variables.locationId ?? job.locationId,
              }
            : job,
        );
      });

      return { previousJob, previousJobsList };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousJob) {
        utils.job.getJob.setData({ jobId }, context.previousJob);
      }
      if (context?.previousJobsList) {
        utils.job.listJobs.setData(undefined, context.previousJobsList);
      }
    },
    onSettled: () => {
      void utils.job.getJob.invalidate({ jobId });
      void utils.job.listJobs.invalidate();
    },
    onSuccess: () => {
      onOpenChange(false);
    },
  });

  const handleSave = () => {
    if (!jobName.trim()) {
      return;
    }

    updateJob.mutate({
      jobId,
      name: jobName.trim(),
      locationId: locationId,
      // Note: jobNumber field would need to be added to the schema and updateJob API
      // For now, this is just a UI placeholder
    });
  };

  const isLoading = updateJob.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Job</DialogTitle>
          <DialogDescription>
            Update the job name, location, and optional job number.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label htmlFor="job-name" className="text-sm font-medium">
              Job Name *
            </label>
            <Input
              id="job-name"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              placeholder="e.g., Smith Bathroom Reno"
              className="mt-1"
              disabled={isLoading}
            />
          </div>
          <div>
            <label htmlFor="location" className="text-sm font-medium">
              Location (Optional)
            </label>
            <div className="mt-1">
              <LocationSelector
                value={locationId ?? undefined}
                onChange={setLocationId}
                disabled={isLoading}
                placeholder="Select location..."
              />
            </div>
          </div>
          <div>
            <label htmlFor="job-number" className="text-sm font-medium">
              Job Number / Reference ID (Optional)
            </label>
            <Input
              id="job-number"
              value={jobNumber}
              onChange={(e) => setJobNumber(e.target.value)}
              placeholder="e.g., JOB-2024-001"
              className="mt-1"
              disabled={isLoading}
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Note: This field requires a schema update to be saved.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!jobName.trim() || isLoading}
          >
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

