"use client";
import { MaterialListCard } from "~/components/materialLists/MaterialListCard";
import { useCardMerge } from "~/components/materialLists/use-card-merge";
import { notify } from "~/components/ui/app-dialogs";
import { PageHeader } from "~/components/ui/page-header";



import { use, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MaterialListOrderPickerDialog } from "~/components/materialLists/VerifyOrderButton";
import { api } from "~/trpc/react";
import { EmptyState } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import {  } from "~/components/ui/dropdown-menu";
import { PlusIcon, WifiOffIcon,  } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,  } from "~/components/ui/dialog";

import { useReplicacheJobDetail } from "~/hooks/use-replicache-jobs";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { getMaterialListReplicache, mutateMaterialListAndSync, requestMaterialListReplicacheSync,  } from "~/lib/replicache-material-list";
import { getNextMaterialListNameFromNames } from "~/lib/material-list-names";
import { setLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";

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
  const utils = api.useUtils();
  const duplicate = api.materialList.duplicate.useMutation({
    onSuccess: ({ id }) => { requestMaterialListReplicacheSync(); void utils.job.getJob.invalidate({ jobId }); router.push(`/dashboard/material-lists/${id}`); },
    onError: error => notify(error.message, "error"),
  });

  const [materialListToDelete, setMaterialListToDelete] = useState<{
    id: string;
    name: string;
    itemCount?: number | null;
  } | null>(null);
  const [materialListForOrders, setMaterialListForOrders] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const isBrowserOnline = useOnlineStatus();

  useEffect(() => {
    setLastJobWorkspaceLocation({
      jobId,
      view: "material-lists",
      materialListId: null,
    });
  }, [jobId]);
  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: isBrowserOnline,
  });
  const canEditLists = userData?.permissions.can["lists.edit"] ?? false;
  const canDeleteCoreRecords = userData?.permissions.can["lists.delete"] ?? true;

  const jobDetail = useReplicacheJobDetail(jobId);
  const { data: serverJob, isFetched: hasFetchedServerJob } =
    api.job.getJob.useQuery(
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
      contributors: [],
    })) ?? null;
  const serverSendStatusByListId = new Map(
    serverJob?.materialLists.map((list) => [
      list.id,
      {
        orderNumbers: list.orderNumbers,
        sentSupplierCount: list.sentSupplierCount,
        totalSupplierCount: list.totalSupplierCount,
        verifiedSupplierCount: list.verifiedSupplierCount,
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

  const listsPending = Boolean(materialLists?.some(list => "pendingSync" in list && list.pendingSync));
  const merge = useCardMerge({
    disabled: !isBrowserOnline || listsPending || duplicate.isPending,
    onMerged: () => { void utils.job.getJob.invalidate({ jobId }); },
  });

  const handleCreateNew = () => {
    if (!job?.id) return;

    const materialListId = crypto.randomUUID();
    void mutateMaterialListAndSync(
      getMaterialListReplicache().mutate.createMaterialList({
        materialListId,
        jobId: job.id,
        name: getNextMaterialListNameFromNames(
          materialLists?.map((list) => list.name) ?? [],
        ),
      }),
    );
    router.push(`/dashboard/material-lists/${materialListId}`);
  };

  const handleConfirmDeleteMaterialList = () => {
    if (!materialListToDelete || !canDeleteCoreRecords) return;

    const { id } = materialListToDelete;
    setMaterialListToDelete(null);
    void mutateMaterialListAndSync(
      getMaterialListReplicache().mutate.deleteMaterialList({
        materialListId: id,
      }),
    );
  };

  if (!job && !hasFetchedServerJob) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1].map((index) => (
              <Card key={index}>
                <CardHeader>
                  <Skeleton className="h-6 w-2/3" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-1/3" />
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
    <div className="px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        {!isBrowserOnline && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
              <WifiOffIcon className="h-4 w-4" />
              Offline mode
            </div>
          </div>
        )}

        <PageHeader
          level="section"
          title="Material Lists"
          actions={
            <div className="hidden flex-wrap items-center gap-2 sm:flex sm:justify-end">
              <Button
                onClick={handleCreateNew}
                size="lg"
                className="hidden h-11 sm:inline-flex sm:w-auto"
              >
                <PlusIcon className="mr-2 h-5 w-5" />
                New Material List
              </Button>
            </div>
          }
        />

        {merge.banner}
        {!materialLists || materialLists.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                art="clipboard"
                title="No material lists yet. Start one for this job."
                action={
                  <Button onClick={handleCreateNew}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    New Material List
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {materialLists.map((list) => (
              <MaterialListCard
                      key={list.id}
                      list={list}
                      merge={merge}
                      canEdit={canEditLists}
                      canDelete={canDeleteCoreRecords}
                      actionsBusy={!isBrowserOnline || listsPending || duplicate.isPending || merge.isPending}
                      onOpen={() => router.push(`/dashboard/material-lists/${list.id}`)}
                      onOrders={() => setMaterialListForOrders({ id: list.id, name: list.name })}
                      onDuplicate={() => duplicate.mutate({ materialListId: list.id })}
                      onDelete={() => setMaterialListToDelete({ id: list.id, name: list.name, itemCount: list.itemCount })}
                    />
            ))}
          </div>
        )}

        <div className="bg-background fixed inset-x-0 bottom-0 z-40 pin-viewport-bottom border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden">
            <Button onClick={handleCreateNew} size="lg" className="h-12 w-full">
              <PlusIcon className="mr-2 h-5 w-5" />
              New Material List
            </Button>
        </div>

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



        <MaterialListOrderPickerDialog
          materialList={materialListForOrders}
          open={!!materialListForOrders}
          onOpenChange={(open) => {
            if (!open) setMaterialListForOrders(null);
          }}
          onVerifyOrder={(orderId) => {
            if (!materialListForOrders) return;
            router.push(
              `/dashboard/material-lists/${materialListForOrders.id}?orderId=${orderId}`,
            );
          }}
        />
      </div>
    </div>
  );
}
