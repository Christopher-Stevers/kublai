"use client";

import { use, useState } from "react";
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
  SendIcon,
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
import { useReplicacheJobDetail } from "~/hooks/use-replicache-jobs";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
} from "~/lib/replicache-material-list";
import { getNextMaterialListNameFromNames } from "~/lib/material-list-names";

type JobLocationDisplay = {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

function getSendStatusTone(sentSupplierCount: number, totalSupplierCount: number) {
  if (totalSupplierCount === 0) {
    return {
      chip: "border-gray-200 bg-gray-50 text-gray-600",
      bar: "bg-gray-300",
    };
  }

  if (sentSupplierCount >= totalSupplierCount) {
    return {
      chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
      bar: "bg-emerald-500",
    };
  }

  if (sentSupplierCount > 0) {
    return {
      chip: "border-amber-200 bg-amber-50 text-amber-700",
      bar: "bg-amber-500",
    };
  }

  return {
    chip: "border-gray-200 bg-gray-50 text-gray-700",
    bar: "bg-gray-400",
  };
}

function MaterialListSendStatus({
  sentSupplierCount = 0,
  totalSupplierCount = 0,
}: {
  sentSupplierCount?: number;
  totalSupplierCount?: number;
}) {
  const normalizedSentCount = Math.min(sentSupplierCount, totalSupplierCount);
  const progress =
    totalSupplierCount > 0
      ? Math.round((normalizedSentCount / totalSupplierCount) * 100)
      : 0;
  const tone = getSendStatusTone(normalizedSentCount, totalSupplierCount);

  return (
    <div className="space-y-1">
      <div
        className={
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium " +
          tone.chip
        }
      >
        <SendIcon className="h-3.5 w-3.5" />
        <span>
          {normalizedSentCount}/{totalSupplierCount} sent
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className={"h-full rounded-full transition-all " + tone.bar}
          style={{ width: progress + "%" }}
        />
      </div>
    </div>
  );
}

function formatLocationAddress(
  location: JobLocationDisplay | null | undefined,
) {
  if (!location) return null;

  const addressLine = [location.address1, location.address2]
    .filter(Boolean)
    .join(" ");
  const cityLine = [location.city, location.region, location.postalCode]
    .filter(Boolean)
    .join(", ");

  return (
    [addressLine, cityLine, location.country].filter(Boolean).join(" • ") ||
    null
  );
}

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId: paramJobId } = use(params);
  const pathname = usePathname();
  const jobId =
    pathname.match(/^\/dashboard\/jobs\/([^/?#]+)/)?.[1] ?? paramJobId;
  const router = useRouter();
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [materialListToDelete, setMaterialListToDelete] = useState<{
    id: string;
    name: string;
    itemCount?: number | null;
  } | null>(null);
  const isBrowserOnline = useOnlineStatus();
  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: isBrowserOnline,
  });
  const canDeleteCoreRecords =
    userData?.permissions.canDeleteCoreRecords ?? true;

  const jobDetail = useReplicacheJobDetail(jobId);
  const { data: serverJob, isFetched: hasFetchedServerJob } = api.job.getJob.useQuery(
    { jobId },
    {
      enabled: isBrowserOnline,
      networkMode: "always",
      refetchOnMount: true,
      refetchOnWindowFocus: false,
    },
  );
  const serverMaterialLists =
    serverJob?.materialLists.map((list) => ({
      ...list,
      jobId,
      quoteId: list.quoteId,
      updatedAt: list.createdAt,
      itemCount: 0,
      materialTotal: 0,
    })) ?? null;
  const serverSendStatusByListId = new Map(
    serverJob?.materialLists.map((list) => [
      list.id,
      {
        sentSupplierCount: list.sentSupplierCount,
        totalSupplierCount: list.totalSupplierCount,
      },
    ]) ?? [],
  );
  const job = jobDetail?.job ?? serverJob ?? null;
  const materialLists = (jobDetail?.materialLists ?? serverMaterialLists)?.map(
    (list) => ({
      ...list,
      ...serverSendStatusByListId.get(list.id),
    }),
  );

  const handleCreateNew = () => {
    if (!job?.id) return;

    const materialListId = crypto.randomUUID();
    void mutateMaterialListAndSync(getMaterialListReplicache().mutate.createMaterialList({
      materialListId,
      jobId: job.id,
      name: getNextMaterialListNameFromNames(
        materialLists?.map((list) => list.name) ?? [],
      ),
    }));
    router.push(`/dashboard/material-lists/${materialListId}`);
  };

  const handleConfirmDeleteMaterialList = () => {
    if (!materialListToDelete || !canDeleteCoreRecords) return;

    const { id } = materialListToDelete;
    setMaterialListToDelete(null);
    void mutateMaterialListAndSync(getMaterialListReplicache().mutate.deleteMaterialList({
      materialListId: id,
    }));
  };

  const jobLocationAddress = formatLocationAddress(job?.location);

  if (!job && !hasFetchedServerJob) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="space-y-3">
            <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-80 animate-pulse rounded bg-gray-200" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1].map((index) => (
              <Card key={index} className="animate-pulse">
                <CardHeader>
                  <div className="h-6 w-2/3 rounded bg-gray-200" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="h-4 w-1/2 rounded bg-gray-200" />
                    <div className="h-4 w-1/3 rounded bg-gray-200" />
                  </div>
                </CardContent>
              </Card>
            ))}
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
            <Button onClick={() => router.push("/dashboard")}>
              Back to Jobs
            </Button>
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

        {/* Job Header */}
        <div className="mb-6">
          <div className="mb-2 flex items-center gap-3">
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
          >
            <PlusIcon className="mr-2 h-5 w-5" />
            New Material List
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
              <Button onClick={handleCreateNew}>
                <PlusIcon className="mr-2 h-4 w-4" />
                New Material List
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
                    <CardTitle className="line-clamp-1 min-w-0">
                      {list.name}
                    </CardTitle>
                    {canDeleteCoreRecords && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-mt-3 -mr-3 h-10 w-10 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                        aria-label={`Delete material list ${list.name}`}
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
                    )}
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
                    <MaterialListSendStatus
                      sentSupplierCount={list.sentSupplierCount}
                      totalSupplierCount={list.totalSupplierCount}
                    />
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
          initialForemanName={job.foremanName ?? null}
          initialPoNumber={job.poNumber ?? null}
        />

        <Dialog
          open={!!materialListToDelete}
          onOpenChange={(open) => {
            if (!open) {
              setMaterialListToDelete(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete material list?</DialogTitle>
              <DialogDescription>
                This will permanently delete{" "}
                {materialListToDelete
                  ? `"${materialListToDelete.name}"`
                  : "this material list"}
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
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!materialListToDelete}
                onClick={handleConfirmDeleteMaterialList}
              >
                Delete Material List
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
