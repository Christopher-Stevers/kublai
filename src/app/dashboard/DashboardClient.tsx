"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { useReplicacheJobDetail, useReplicacheJobsList } from "~/hooks/use-replicache-jobs";
import { useReplicacheMaterialList } from "~/hooks/use-replicache-material-list";
import { useReplicacheSuppliers } from "~/hooks/use-replicache-suppliers";
import { MaterialListItem } from "~/components/materialLists/MaterialListItem";
import { AddPartDialog } from "~/components/materialLists/AddPartDialog";
import { getBrowserOnlineStatus, useOnlineStatus } from "~/hooks/use-online-status";
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
} from "~/lib/replicache-material-list";
import { getNextMaterialListNameFromNames } from "~/lib/material-list-names";
import {
  HEADER_BACK_REQUEST_EVENT,
  setHeaderBackVisible,
} from "~/lib/header-back-events";

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

export type DashboardJob = {
  id: string;
  name: string;
  poNumber: string | null;
  locationId: string | null;
  foremanName: string | null;
  status: string;
  createdAt: string | Date;
  location: (JobLocationDisplay & { id?: string | null }) | null;
  foreman: { id: string | null; name: string | null } | null;
  materialListCount: number;
};

export function DashboardClient({ initialJobs }: { initialJobs: DashboardJob[] }) {
  const router = useRouter();
  const hasRedirectedRef = useRef(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newJobName, setNewJobName] = useState("");
  const [jobToDelete, setJobToDelete] = useState<{
    id: string;
    name: string;
    materialListCount?: number | null;
  } | null>(null);
  const [offlineJobId, setOfflineJobId] = useState<string | null>(null);
  const [offlineMaterialListId, setOfflineMaterialListId] = useState<string | null>(null);
  const [forceOfflineView, setForceOfflineView] = useState(false);
  const [showOfflineAddPartDialog, setShowOfflineAddPartDialog] = useState(false);
  const isBrowserOnline = useOnlineStatus();
  const shouldUseOfflineView = forceOfflineView || !isBrowserOnline;

  // Check user's organizationId status
  const { data: userData, isFetched: hasFetchedUser } =
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

    if (hasFetchedUser && userData && !userData.organizationId) {
      if (typeof window !== "undefined") {
        hasRedirectedRef.current = true;
        window.location.href = "/onboarding";
      }
    }
  }, [hasFetchedUser, hasRedirectedRef, userData]);

  const replicacheJobs = useReplicacheJobsList();
  const offlineJobDetail = useReplicacheJobDetail(offlineJobId ?? "");
  const offlineMaterialListDetail = useReplicacheMaterialList(offlineMaterialListId ?? "");
  const suppliers = useReplicacheSuppliers();
  const jobs = replicacheJobs.length > 0 ? replicacheJobs : initialJobs;
  const isWaitingForJobs = false;

  useEffect(() => {
    if (!isBrowserOnline || jobs.length === 0) return;

    // Warm the App Router/RSC cache while online so tapping a job can work
    // after the device loses connectivity.
    for (const job of jobs.slice(0, 50)) {
      router.prefetch(`/dashboard/jobs/${job.id}`);
    }
  }, [isBrowserOnline, jobs, router]);

  const openJob = (jobId: string) => {
    if (!getBrowserOnlineStatus() || shouldUseOfflineView) {
      setForceOfflineView(true);
      setOfflineJobId(jobId);
      setOfflineMaterialListId(null);
      return;
    }

    router.push(`/dashboard/jobs/${jobId}`);
  };

  const handleCreateJob = () => {
    if (newJobName.trim()) {
      const jobId = crypto.randomUUID();
      void mutateMaterialListAndSync(getMaterialListReplicache().mutate.createJob({
        jobId,
        name: newJobName.trim(),
      }));
      setShowCreateDialog(false);
      setNewJobName("");
      router.push(`/dashboard/jobs/${jobId}`);
    }
  };

  const handleCreateMaterialList = (jobId: string) => {
    const materialListId = crypto.randomUUID();
    const existingNames =
      offlineJobDetail?.job?.id === jobId
        ? offlineJobDetail.materialLists.map((list) => list.name)
        : [];
    void mutateMaterialListAndSync(getMaterialListReplicache().mutate.createMaterialList({
      materialListId,
      jobId,
      name: getNextMaterialListNameFromNames(existingNames),
    }));

    if (shouldUseOfflineView || !getBrowserOnlineStatus()) {
      setForceOfflineView(true);
      setOfflineJobId(jobId);
      setOfflineMaterialListId(materialListId);
      return;
    }

    router.push(`/dashboard/material-lists/${materialListId}`);
  };

  const handleConfirmDeleteJob = () => {
    if (!jobToDelete || !canDeleteCoreRecords) return;
    const { id } = jobToDelete;
    setJobToDelete(null);
    void mutateMaterialListAndSync(getMaterialListReplicache().mutate.deleteJob({ jobId: id }));
  };

  const handleLocalWorkspaceBack = useCallback(() => {
    if (offlineMaterialListId) {
      setOfflineMaterialListId(null);
      return;
    }

    setOfflineJobId(null);
    setForceOfflineView(!getBrowserOnlineStatus());
  }, [offlineMaterialListId]);

  useEffect(() => {
    const showBackButton = Boolean(offlineJobId && shouldUseOfflineView);
    setHeaderBackVisible(showBackButton);

    if (!showBackButton) {
      return () => setHeaderBackVisible(false);
    }

    const handleHeaderBackRequest = () => {
      handleLocalWorkspaceBack();
    };

    window.addEventListener(HEADER_BACK_REQUEST_EVENT, handleHeaderBackRequest);

    return () => {
      window.removeEventListener(HEADER_BACK_REQUEST_EVENT, handleHeaderBackRequest);
      setHeaderBackVisible(false);
    };
  }, [handleLocalWorkspaceBack, offlineJobId, shouldUseOfflineView]);

  if (hasFetchedUser && userData && !userData.organizationId) return null;


  if (offlineJobId && shouldUseOfflineView) {
    const fallbackJob = jobs.find((job) => job.id === offlineJobId) ?? null;
    const offlineJob = offlineJobDetail?.job ?? fallbackJob;
    const offlineMaterialLists = offlineJobDetail?.materialLists ?? [];
    const selectedMaterialList = offlineMaterialListDetail.materialList;
    const selectedItems = offlineMaterialListDetail.items;
    const jobLocationAddress = formatLocationAddress(offlineJob?.location);

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

          {offlineMaterialListId ? (
            selectedMaterialList ? (
              <>
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                      {selectedMaterialList.name}
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Offline material-list mode. Adds and edits queue locally and sync on reconnect.
                    </p>
                  </div>
                  <Button
                    size="lg"
                    className="h-11 w-full sm:w-auto"
                    onClick={() => setShowOfflineAddPartDialog(true)}
                  >
                    <PlusIcon className="mr-2 h-5 w-5" />
                    Add Part
                  </Button>
                </div>

                {selectedItems.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
                      <h3 className="mb-2 text-lg font-semibold">No items yet</h3>
                      <p className="text-muted-foreground mb-4 text-center">
                        Add parts now. They’ll stay on this device and sync when online.
                      </p>
                      <Button onClick={() => setShowOfflineAddPartDialog(true)}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        Add Part
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {selectedItems.map((item) => (
                      <MaterialListItem
                        key={item.id}
                        materialListId={selectedMaterialList.id}
                        suppliers={suppliers}
                        syncStatus={item.pendingSync ? "pending" : "synced"}
                        item={{
                          ...item,
                          selectedSupplierId: item.supplierId,
                          partDefinition: item.partDefinition ?? null,
                          supplierPart: item.supplierPart ?? null,
                        }}
                      />
                    ))}
                  </div>
                )}

                <AddPartDialog
                  open={showOfflineAddPartDialog}
                  onOpenChange={setShowOfflineAddPartDialog}
                  materialListId={selectedMaterialList.id}
                />
              </>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
                  <h3 className="mb-2 text-lg font-semibold">Material list not cached</h3>
                  <p className="text-muted-foreground text-center">
                    Reconnect once to cache this material list on this device.
                  </p>
                </CardContent>
              </Card>
            )
          ) : offlineJob ? (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                  {offlineJob.name}
                </h1>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
                  {jobLocationAddress && (
                    <div className="flex items-center gap-2">
                      <MapPinIcon className="h-4 w-4" />
                      <span>{jobLocationAddress}</span>
                    </div>
                  )}
                  {offlineJob.foremanName && (
                    <div className="flex items-center gap-2">
                      <UserIcon className="h-4 w-4" />
                      <span>{offlineJob.foremanName}</span>
                    </div>
                  )}
                  {offlineJob.poNumber && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">PO#:</span>
                      <span>{offlineJob.poNumber}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Material Lists</h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Create and manage material lists offline. New lists sync when reconnected.
                  </p>
                </div>
                <Button
                  onClick={() => handleCreateMaterialList(offlineJob.id)}
                  size="lg"
                  className="h-11 w-full sm:w-auto"
                >
                  <PlusIcon className="mr-2 h-5 w-5" />
                  New Material List
                </Button>
              </div>

              {offlineMaterialLists.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
                    <h3 className="mb-2 text-lg font-semibold">No material lists yet</h3>
                    <p className="text-muted-foreground mb-4 text-center">
                      Create one now. It’ll stay on this device and sync when online.
                    </p>
                    <Button onClick={() => handleCreateMaterialList(offlineJob.id)}>
                      <PlusIcon className="mr-2 h-4 w-4" />
                      New Material List
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {offlineMaterialLists.map((list) => (
                    <Card
                      key={list.id}
                      className="cursor-pointer transition-shadow hover:shadow-md"
                      onClick={() => setOfflineMaterialListId(list.id)}
                    >
                      <CardHeader>
                        <CardTitle className="line-clamp-2 min-w-0 break-words leading-tight">
                          {list.name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 text-sm text-gray-600">
                          <div className="flex items-center gap-2">
                            <PackageIcon className="h-4 w-4" />
                            <span>{list.itemCount} items</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">Total:</span>
                            <span>${list.materialTotal.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CalendarIcon className="h-4 w-4" />
                            <span>{format(new Date(list.createdAt), "MMM d, yyyy")}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BriefcaseIcon className="mb-4 h-12 w-12 text-gray-400" />
                <h3 className="mb-2 text-lg font-semibold">Job not cached</h3>
                <p className="text-muted-foreground text-center">
                  Reconnect once to cache this job on this device.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        {shouldUseOfflineView && (
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

        {isWaitingForJobs ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Card key={index} className="animate-pulse">
                <CardHeader>
                  <div className="h-6 w-2/3 rounded bg-gray-200" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="h-4 w-4/5 rounded bg-gray-200" />
                    <div className="h-4 w-1/2 rounded bg-gray-200" />
                    <div className="h-4 w-1/3 rounded bg-gray-200" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : jobs.length === 0 ? (
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
