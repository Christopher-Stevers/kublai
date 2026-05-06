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
  initialForemanName?: string | null;
  initialPoNumber?: string | null;
}

export function JobEditDialog({
  open,
  onOpenChange,
  jobId,
  initialName,
  initialLocationId,
  initialForemanName,
  initialPoNumber,
}: JobEditDialogProps) {
  const [jobName, setJobName] = useState(initialName || "");
  const [locationId, setLocationId] = useState<string | null>(
    initialLocationId ?? null,
  );
  const [poNumber, setPoNumber] = useState(initialPoNumber || "");
  const [foremanName, setForemanName] = useState(initialForemanName || "");

  // Update local state when initial values change
  useEffect(() => {
    setJobName(initialName || "");
    setLocationId(initialLocationId ?? null);
    setPoNumber(initialPoNumber || "");
    setForemanName(initialForemanName || "");
  }, [initialName, initialLocationId, initialForemanName, initialPoNumber, open]);

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
          poNumber: variables.poNumber ?? old.poNumber,
          locationId: variables.locationId ?? old.locationId,
          foremanName: variables.foremanName ?? old.foremanName,
          foreman: {
            id: old.foreman?.id ?? "",
            name: variables.foremanName ?? old.foreman?.name ?? "",
          },
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
                poNumber: variables.poNumber ?? job.poNumber,
                locationId: variables.locationId ?? job.locationId,
                foremanName: variables.foremanName ?? job.foremanName,
                foreman: {
                  id: job.foreman?.id ?? "",
                  name: variables.foremanName ?? job.foreman?.name ?? "",
                },
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
      poNumber: poNumber.trim() || null,
      foremanName: foremanName.trim() || null,
    });
  };

  const isLoading = updateJob.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Job</DialogTitle>
          <DialogDescription>
            Update the job name, location, and PO number.
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
            <label htmlFor="foreman-name" className="text-sm font-medium">
              Foreman Name (Optional)
            </label>
            <Input
              id="foreman-name"
              value={foremanName}
              onChange={(e) => setForemanName(e.target.value)}
              placeholder="e.g., Mike"
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
            <label htmlFor="po-number" className="text-sm font-medium">
              PO Number (Optional)
            </label>
            <Input
              id="po-number"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="e.g., PO-2024-001"
              className="mt-1"
              disabled={isLoading}
            />
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
