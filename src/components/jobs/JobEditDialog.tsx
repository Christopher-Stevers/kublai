"use client";

import { useState, useEffect } from "react";
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
import { updateOfflineJob } from "~/lib/offline-jobs";

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

  const handleSave = () => {
    if (!jobName.trim()) {
      return;
    }

    updateOfflineJob(jobId, {
      name: jobName.trim(),
      locationId: locationId,
      poNumber: poNumber.trim() || null,
      foremanName: foremanName.trim() || null,
    });
    onOpenChange(false);
  };

  const isLoading = false;

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
