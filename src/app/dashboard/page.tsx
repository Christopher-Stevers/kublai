"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  BriefcaseIcon,
  CalendarIcon,
  UserIcon,
  MapPinIcon,
  PackageIcon,
  PlusIcon,
  TrashIcon,
  WifiOffIcon,
} from "lucide-react";
import { format } from "date-fns";
import { useReplicacheJobsList } from "~/hooks/use-replicache-jobs";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { getMaterialListReplicache } from "~/lib/replicache-material-list";

type JobLocationDisplay = {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

function formatLocationAddress(location: JobLocationDisplay | null | undefined) {
  if (!location) return null;

  const addressLine = [location.address1, location.address2]
    .filter(Boolean)
    .join(" ");
  const cityLine = [location.city, location.region, location.postalCode]
    .filter(Boolean)
    .join(", ");

  return (
    [addressLine, cityLine, location.country].filter(Boolean).join(" • ") ||
    location.name ||
    null
  );
}

export default function Dashboard() {
  const router = useRouter();
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasRedirectedRef = useRef(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newJobName, setNewJobName] = useState("");
  const [jobToDelete, setJobToDelete] = useState<{
    id: string;
    name: string;
    materialListCount?: number | null;
  } | null>(null);
  const isBrowserOnline = useOnlineStatus();

  // Check user's organizationId status
  const { data: userData, isLoading: isLoadingUser } =
    api.user.getMyRole.useQuery(undefined, {
      enabled: isBrowserOnline,
      refetchOnMount: true,
      refetchOnWindowFocus: false,
    });
  const canDeleteCoreRecords =
    userData?.permissions.canDeleteCoreRecords ?? true;

  // Redirect to onboarding if user has no organizationId
  useEffect(() => {
    if (hasRedirectedRef.current) {
      return;
    }

    if (userData && !userData.organizationId) {
      if (typeof window !== "undefined") {
        hasRedirectedRef.current = true;
        window.location.href = "/onboarding";
      }
      return;
    }

    if (isLoadingUser && !userData) {
      pollingTimeoutRef.current = setTimeout(() => {
        if (!hasRedirectedRef.current && typeof window !== "undefined") {
          hasRedirectedRef.current = true;
          window.location.href = "/onboarding";
        }
      }, 2000);
    }

    return () => {
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
      }
    };
  }, [userData, isLoadingUser]);

  const jobs = useReplicacheJobsList();

  const openJob = (jobId: string) => {
    router.push(`/dashboard/jobs/${jobId}`);
  };

  const handleCreateJob = () => {
    if (newJobName.trim()) {
      const jobId = crypto.randomUUID();
      void getMaterialListReplicache().mutate.createJob({
        jobId,
        name: newJobName.trim(),
      });
      setShowCreateDialog(false);
      setNewJobName("");
      router.push(`/dashboard/jobs/${jobId}`);
    }
  };

  const handleConfirmDeleteJob = () => {
    if (!jobToDelete || !canDeleteCoreRecords) return;
    const { id } = jobToDelete;
    setJobToDelete(null);
    void getMaterialListReplicache().mutate.deleteJob({ jobId: id });
  };

  if (isLoadingUser || (userData && !userData.organizationId)) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">
              {isLoadingUser ? "Loading..." : "Setting up your account..."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        {!isBrowserOnline && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
              <WifiOffIcon className="h-4 w-4" />
              Offline mode
            </div>
          </div>
        )}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              Dashboard
            </h1>
            <p className="text-muted-foreground mt-2 text-sm sm:text-base">
              Select a job to view and manage its material lists
            </p>
          </div>
          <Button
            onClick={() => setShowCreateDialog(true)}
            size="lg"
            className="h-11 w-full sm:w-auto"
          >
            <PlusIcon className="mr-2 h-5 w-5" />
            Add Job
          </Button>
        </div>

        {jobs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <BriefcaseIcon className="mb-4 h-12 w-12 text-gray-400" />
              <h3 className="mb-2 text-lg font-semibold">No jobs yet</h3>
              <p className="text-muted-foreground mb-4 text-center">
                Create your first job to get started
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <Card
                key={job.id}
                className="group cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => openJob(job.id)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="line-clamp-1 min-w-0">
                      {job.name}
                    </CardTitle>
                    {canDeleteCoreRecords && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                        aria-label={`Delete job ${job.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setJobToDelete({
                            id: job.id,
                            name: job.name,
                            materialListCount: job.materialListCount,
                          });
                        }}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm text-gray-600">
                    {job.location && (
                      <div className="flex items-center gap-2">
                        <MapPinIcon className="h-4 w-4" />
                        <span className="line-clamp-1">
                          {formatLocationAddress(job.location)}
                        </span>
                      </div>
                    )}
                    {job.foremanName && (
                      <div className="flex items-center gap-2">
                        <UserIcon className="h-4 w-4" />
                        <span>{job.foremanName}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <PackageIcon className="h-4 w-4" />
                      <span>
                        {job.materialListCount ?? 0}{" "}
                        {job.materialListCount === 1 ? "list" : "lists"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4" />
                      <span>
                        {format(new Date(job.createdAt), "MMM d, yyyy")}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create Job Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Job</DialogTitle>
              <DialogDescription>
                Enter a name for your new job.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label htmlFor="job-name" className="text-sm font-medium">
                  Job Name *
                </label>
                <Input
                  id="job-name"
                  value={newJobName}
                  onChange={(e) => setNewJobName(e.target.value)}
                  placeholder="e.g., Smith Bathroom Reno"
                  className="mt-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newJobName.trim()) {
                      handleCreateJob();
                    }
                  }}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateJob}
                disabled={!newJobName.trim()}
              >
                Create Job
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!jobToDelete}
          onOpenChange={(open) => {
            if (!open) setJobToDelete(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete job?</DialogTitle>
              <DialogDescription>
                This will permanently delete{" "}
                {jobToDelete ? `"${jobToDelete.name}"` : "this job"}
                {jobToDelete?.materialListCount
                  ? ` and ${jobToDelete.materialListCount} material ${
                      jobToDelete.materialListCount === 1 ? "list" : "lists"
                    }`
                  : ""}
                . This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setJobToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!jobToDelete}
                onClick={handleConfirmDeleteJob}
              >
                Delete Job
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
