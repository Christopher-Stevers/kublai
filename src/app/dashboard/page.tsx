"use client";

import { usePathname, useRouter } from "next/navigation";
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
import { useOfflineJobsList } from "~/hooks/use-offline-jobs";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  createOfflineJob,
  getOfflineJobDetail,
  getOfflineJobsList,
  tombstoneOfflineJob,
} from "~/lib/offline-jobs";
import {
  getOfflineMutationQueue,
  setOfflineMutationQueue,
} from "~/lib/offline-material-list-mutations";

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
  const pathname = usePathname();
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
  const routedJobId =
    pathname.match(/^\/dashboard\/jobs\/([^/?#]+)/)?.[1] ?? null;

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
  // This is a fallback in case server-side redirect didn't work
  useEffect(() => {
    if (hasRedirectedRef.current) {
      return;
    }

    // If we have user data and no organizationId, redirect immediately
    if (userData && !userData.organizationId) {
      if (typeof window !== "undefined") {
        hasRedirectedRef.current = true;
        window.location.href = "/onboarding";
      }
      return;
    }

    // If still loading after 2 seconds, redirect anyway
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

  // Get all jobs for fresh browser/profile bootstrap. The hook seeds Dexie and
  // still renders from local state after import.
  const { data: serverJobs, isLoading } = api.job.listJobs.useQuery(undefined, {
    enabled: isBrowserOnline,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
  const {
    data: jobs,
    cacheLoaded,
    isOnline,
    isOfflineFallback,
  } = useOfflineJobsList(serverJobs);

  const openJob = (jobId: string) => {
    const href = `/dashboard/jobs/${jobId}`;
    if (!isOnline) {
      window.location.href = href;
      return;
    }

    router.push(href);
  };

  const handleCreateJob = () => {
    if (newJobName.trim()) {
      const job = createOfflineJob(newJobName.trim());
      setShowCreateDialog(false);
      setNewJobName("");
      router.push(`/dashboard/jobs/${job.id}`);
      return;
    }
  };

  const handleConfirmDeleteJob = () => {
    if (!jobToDelete || !canDeleteCoreRecords) return;

    const { id } = jobToDelete;
    setJobToDelete(null);

    const deletedMaterialListIds =
      getOfflineJobDetail(id)?.data.materialLists.map((list) => list.id) ?? [];
    tombstoneOfflineJob(id);
    void getOfflineMutationQueue().then((queue) =>
      setOfflineMutationQueue(
        queue.filter(
          (mutation) =>
            !deletedMaterialListIds.includes(mutation.materialListId),
        ),
      ),
    );

    return;
  };

  // Do not auto-create placeholder jobs. In local-first mode those placeholders
  // can become stale local ghosts if the browser cache/outbox is interrupted.

  // Hard local-only mode for jobs/material lists: do not warm/import from server.


  if (routedJobId) {
    return <OfflineJobRouteFallback jobId={routedJobId} />;
  }

  // Show loading state while checking if onboarding is needed
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

  if ((isLoading || !cacheLoaded) && !jobs) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">
              Loading jobs...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {!isOnline && (
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
              <WifiOffIcon className="h-4 w-4" />
              Offline mode
            </div>
          )}
          {isOfflineFallback && (
            <div className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-900">
              Showing cached jobs
            </div>
          )}
        </div>
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

        {!jobs || jobs.length === 0 ? (
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
                    {job.foreman && (
                      <div className="flex items-center gap-2">
                        <UserIcon className="h-4 w-4" />
                        <span>{job.foreman.name}</span>
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

function OfflineJobRouteFallback({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState(
    () => getOfflineJobDetail(jobId)?.data ?? null,
  );

  useEffect(() => {
    setDetail(getOfflineJobDetail(jobId)?.data ?? null);
  }, [jobId]);

  const summary =
    getOfflineJobsList()?.data.find((job) => job.id === jobId) ?? null;
  const job = detail?.job ?? summary;
  const materialLists = detail?.materialLists ?? [];

  if (!job) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
            <WifiOffIcon className="h-4 w-4" />
            Offline mode
          </div>
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground mb-4">
                This job is not cached for offline use yet.
              </p>
              <Button onClick={() => router.push("/dashboard")}>
                Back to Jobs
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
            <WifiOffIcon className="h-4 w-4" />
            Offline mode
          </div>
          <div className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-900">
            Showing cached job
          </div>
        </div>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            {job.name}
          </h1>
          <div className="text-muted-foreground mt-3 flex flex-wrap gap-4 text-sm">
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="h-4 w-4" />
                {job.location.name}
              </span>
            )}
            {job.foreman && (
              <span className="inline-flex items-center gap-1">
                <UserIcon className="h-4 w-4" />
                {job.foreman.name}
              </span>
            )}
          </div>
        </div>

        {materialLists.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
              <p className="text-muted-foreground text-center">
                No cached material lists for this job yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {materialLists.map((list) => (
              <Card
                key={list.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => {
                  window.location.href = `/dashboard/material-lists/${list.id}`;
                }}
              >
                <CardHeader>
                  <CardTitle className="line-clamp-1">{list.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <PackageIcon className="h-4 w-4" />
                      <span>
                        {list.itemCount ?? 0}{" "}
                        {list.itemCount === 1 ? "item" : "items"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4" />
                      <span>
                        {format(new Date(list.createdAt), "MMM d, yyyy")}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
