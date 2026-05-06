"use client";

import { use, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  PlusIcon,
  PackageIcon,
  CalendarIcon,
  UserIcon,
  MapPinIcon,
  PencilIcon,
  TrashIcon,
  WifiOffIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { format } from "date-fns";
import { JobEditDialog } from "~/components/jobs/JobEditDialog";
import { useOfflineJobDetail } from "~/hooks/use-offline-jobs";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  createOfflineMaterialList,
  tombstoneOfflineMaterialList,
} from "~/lib/offline-jobs";
import { clearOfflineMaterialList, setOfflineMaterialList } from "~/lib/offline-material-list";
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

  return [addressLine, cityLine, location.country].filter(Boolean).join(" • ") || null;
}

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId: paramJobId } = use(params);
  const pathname = usePathname();
  const jobId = pathname.match(/^\/dashboard\/jobs\/([^/?#]+)/)?.[1] ?? paramJobId;
  const router = useRouter();
  const utils = api.useUtils();
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [materialListToDelete, setMaterialListToDelete] = useState<{
    id: string;
    name: string;
    itemCount?: number | null;
  } | null>(null);
  const isBrowserOnline = useOnlineStatus();

  useEffect(() => {
    if (!jobId.startsWith("offline-job-") || typeof window === "undefined") return;

    const redirectIfMapped = () => {
      const idMap = JSON.parse(
        window.localStorage.getItem("foremanhq.offline.id-map") ?? "{}",
      ) as Record<string, string>;
      const mappedId = idMap[jobId];
      if (mappedId) router.replace(`/dashboard/jobs/${mappedId}`);
    };

    redirectIfMapped();
    window.addEventListener("foremanhq:offline-id-map-changed", redirectIfMapped);
    return () => window.removeEventListener("foremanhq:offline-id-map-changed", redirectIfMapped);
  }, [jobId, router]);

  // Get job details
  const { data: serverJob, isLoading: jobLoading } = api.job.getJob.useQuery(
    { jobId },
    { enabled: !!jobId && isBrowserOnline },
  );

  // Get material lists for this job
  const { data: serverMaterialLists, isLoading: listsLoading } =
    api.materialList.listMaterialLists.useQuery(
      { jobId },
      { enabled: !!jobId && isBrowserOnline },
    );

  const {
    data: offlineJobData,
    cacheLoaded,
    isOnline,
    isOfflineFallback,
  } = useOfflineJobDetail(jobId, serverJob, serverMaterialLists);

  const job = offlineJobData?.job ?? null;
  const materialLists = offlineJobData?.materialLists ?? null;

  const createMaterialList = api.materialList.createMaterialList.useMutation({
    onSuccess: (data) => {
      void utils.materialList.listMaterialLists.invalidate({ jobId });
      void utils.job.getJob.invalidate({ jobId });
      router.push(`/dashboard/material-lists/${data.materialListId}`);
    },
  });

  const deleteMaterialList = api.materialList.deleteMaterialList.useMutation({
    onSuccess: () => {
      void utils.materialList.listMaterialLists.invalidate({ jobId });
      void utils.job.getJob.invalidate({ jobId });
    },
  });

  const handleCreateNew = () => {
    if (createMaterialList.isPending || !job?.id) {
      return;
    }

    if (!isBrowserOnline) {
      const materialList = createOfflineMaterialList(job.id);
      void setOfflineMaterialList(
        materialList.id,
        {
          materialList: {
            id: materialList.id,
            name: materialList.name,
            createdAt: materialList.createdAt,
          },
          job,
          quote: { id: `offline-quote-${materialList.id}` },
          items: [],
          materialTotal: 0,
        },
        { pendingSync: true },
      ).then(() => router.push(`/dashboard/material-lists/${materialList.id}`));
      return;
    }

    createMaterialList.mutate({ jobId: job.id });
  };

  const handleConfirmDeleteMaterialList = () => {
    if (!materialListToDelete) {
      return;
    }

    const { id } = materialListToDelete;
    setMaterialListToDelete(null);

    if (!isBrowserOnline) {
      tombstoneOfflineMaterialList(jobId, id);
      void clearOfflineMaterialList(id);
      void getOfflineMutationQueue().then((queue) =>
        setOfflineMutationQueue(queue.filter((mutation) => mutation.materialListId !== id)),
      );
      return;
    }

    deleteMaterialList.mutate({ materialListId: id });
  };

  const isLoading = jobLoading || listsLoading;
  const jobLocationAddress = formatLocationAddress(job?.location);

  if ((isLoading || !cacheLoaded) && !job) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading job details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">Job not found</p>
            <Button onClick={() => router.push("/dashboard")}>Back to Jobs</Button>
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
              Showing cached job and material lists
            </div>
          )}
        </div>
        {/* Job Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              {job.name}
            </h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEditDialog(true)}
              className="h-8 w-8 p-0"
              aria-label="Edit job"
            >
              <PencilIcon className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
            {jobLocationAddress && (
              <div className="flex items-center gap-2">
                <MapPinIcon className="h-4 w-4" />
                <span>{jobLocationAddress}</span>
              </div>
            )}
            {(job.foremanName || job.foreman?.name) && (
              <div className="flex items-center gap-2">
                <UserIcon className="h-4 w-4" />
                <span>{job.foremanName ?? job.foreman?.name}</span>
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

        {/* Material Lists Section */}
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Material Lists
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Create and manage material lists for this job
            </p>
          </div>
          <Button
            onClick={handleCreateNew}
            size="lg"
            className="h-11 w-full sm:w-auto"
            disabled={createMaterialList.isPending}
          >
            <PlusIcon className="mr-2 h-5 w-5" />
            {createMaterialList.isPending ? "Creating..." : "New Material List"}
          </Button>
        </div>

        {!materialLists || materialLists.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
              <h3 className="mb-2 text-lg font-semibold">
                No material lists yet
              </h3>
              <p className="text-muted-foreground mb-4 text-center">
                Create your first material list to get started
              </p>
              <Button
                onClick={handleCreateNew}
                disabled={createMaterialList.isPending}
              >
                <PlusIcon className="mr-2 h-4 w-4" />
                {createMaterialList.isPending ? "Creating..." : "New Material List"}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {materialLists.map((list) => (
              <Card
                key={list.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() =>
                  router.push(`/dashboard/material-lists/${list.id}`)
                }
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="line-clamp-1 min-w-0">{list.name}</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                      aria-label={`Delete material list ${list.name}`}
                      disabled={deleteMaterialList.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMaterialListToDelete({
                          id: list.id,
                          name: list.name,
                          itemCount: list.itemCount,
                        });
                      }}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </div>
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
                    {list.foreman && (
                      <div className="flex items-center gap-2">
                        <UserIcon className="h-4 w-4" />
                        <span>{list.foreman.name}</span>
                      </div>
                    )}
                    {((list as unknown as { createdBy?: { name: string } | null }).createdBy) && (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Created by:</span>
                        <span>
                          {
                            (list as unknown as { createdBy: { name: string } }).createdBy
                              .name
                          }
                        </span>
                      </div>
                    )}
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

        {/* Edit Dialog */}
        <JobEditDialog
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          jobId={jobId}
          initialName={job.name}
          initialLocationId={job.locationId}
          initialForemanName={job.foremanName ?? job.foreman?.name ?? null}
          initialPoNumber={job.poNumber ?? null}
        />

        <Dialog
          open={!!materialListToDelete}
          onOpenChange={(open) => {
            if (!open && !deleteMaterialList.isPending) {
              setMaterialListToDelete(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete material list?</DialogTitle>
              <DialogDescription>
                This will permanently delete {materialListToDelete ? `"${materialListToDelete.name}"` : "this material list"}
                {materialListToDelete?.itemCount
                  ? ` and ${materialListToDelete.itemCount} ${
                      materialListToDelete.itemCount === 1 ? "item" : "items"
                    }`
                  : ""}
                . This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMaterialListToDelete(null)}
                disabled={deleteMaterialList.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!materialListToDelete || deleteMaterialList.isPending}
                onClick={handleConfirmDeleteMaterialList}
              >
                {deleteMaterialList.isPending ? "Deleting..." : "Delete Material List"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
