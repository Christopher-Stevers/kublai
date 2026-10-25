"use client";

import { useState } from "react";
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
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useWorkspaceMutations } from "~/hooks/use-workspace-mutations";

interface JobInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
  initialName?: string | null;
  initialLocationId?: string;
}

export function JobInfoModal({
  open,
  onOpenChange,
  materialListId,
  initialName,
  initialLocationId,
}: JobInfoModalProps) {
  const {
    getReplicache: getMaterialListReplicache,
    mutateAndSync: mutateMaterialListAndSync,
  } = useWorkspaceMutations();
  const [jobName, setJobName] = useState(initialName || "");
  const [locationId, setLocationId] = useState<string | null>(
    initialLocationId ?? null,
  );
  const [session, setSession] = useState({ open, materialListId });
  if (session.open !== open || session.materialListId !== materialListId) {
    setSession({ open, materialListId });
    setJobName(initialName ?? "");
    setLocationId(initialLocationId ?? null);
  }
  const isOnline = useOnlineStatus();
  const { data: materialList } = api.materialList.getMaterialList.useQuery(
    { materialListId },
    { enabled: isOnline && open && !!materialListId },
  );
  const handleSave = () => {
    if (!jobName.trim()) {
      return;
    }

    const jobId =
      materialList?.job &&
      typeof materialList.job === "object" &&
      "id" in materialList.job
        ? materialList.job.id
        : null;

    if (jobId) {
      void mutateMaterialListAndSync(
        getMaterialListReplicache().mutate.updateJob({
          jobId,
          name: jobName.trim(),
          locationId,
        }),
      );
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Job Details</DialogTitle>
          <DialogDescription>
            Enter the job name and optional location for this material list.
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
            />
          </div>
          <div>
            <label htmlFor="location" className="text-sm font-medium">
              Location (Optional)
            </label>
            <LocationSelector value={locationId} onChange={setLocationId} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!jobName.trim()}>
            Save & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
