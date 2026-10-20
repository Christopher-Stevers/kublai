"use client";
import { useCardMerge } from "~/components/materialLists/use-card-merge";
import { notify } from "~/components/ui/app-dialogs";
import { PageHeader } from "~/components/ui/page-header";
import { CopyIcon, MergeIcon } from "lucide-react";
import { FinancialOnly } from "~/components/permissions/FinancialVisibility";

import { use, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MaterialListOrderPickerDialog } from "~/components/materialLists/VerifyOrderButton";
import { api } from "~/trpc/react";
import { EmptyState } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  PlusIcon,
  PackageIcon,
  CalendarIcon,
  CheckCircle2Icon,
  UserIcon,
  UsersIcon,
  SendIcon,
  MoreVerticalIcon,
  TrashIcon,
  WifiOffIcon,
  WrenchIcon,
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
import { useReplicacheJobDetail } from "~/hooks/use-replicache-jobs";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
  requestMaterialListReplicacheSync,
} from "~/lib/replicache-material-list";
import { getNextMaterialListNameFromNames } from "~/lib/material-list-names";
import { setLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";

function getSendStatusTone(
  sentSupplierCount: number,
  totalSupplierCount: number,
) {
  if (totalSupplierCount === 0) {
    return {
      chip: "border-border bg-muted/50 text-muted-foreground",
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
    chip: "border-border bg-muted/50 text-foreground/80",
    bar: "bg-gray-400",
  };
}

function MaterialListSendStatus({
  sentSupplierCount = 0,
  totalSupplierCount = 0,
  verifiedSupplierCount = 0,
}: {
  sentSupplierCount?: number;
  totalSupplierCount?: number;
  verifiedSupplierCount?: number;
}) {
  const normalizedSentCount = Math.min(sentSupplierCount, totalSupplierCount);
  const normalizedVerifiedCount = Math.min(
    verifiedSupplierCount,
    normalizedSentCount,
  );
  const progress =
    totalSupplierCount > 0
      ? Math.round((normalizedSentCount / totalSupplierCount) * 100)
      : 0;
  const tone = getSendStatusTone(normalizedSentCount, totalSupplierCount);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
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
        {normalizedSentCount > 0 && (
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-xs font-medium text-foreground/80">
            <CheckCircle2Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              {normalizedVerifiedCount}/{normalizedSentCount} verified
            </span>
          </div>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={"h-full rounded-full transition-all " + tone.bar}
          style={{ width: progress + "%" }}
        />
      </div>
    </div>
  );
}


function formatContributorName(contributor: {
  name: string | null;
  email: string | null;
}) {
  return contributor.name?.trim() || contributor.email?.trim() || "Unknown";
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
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressHandledRef = useRef(false);
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

  const clearLongPressTimer = () => {
    if (!longPressTimerRef.current) return;
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const startMaterialListLongPress = (list: { id: string; name: string }) => {
    clearLongPressTimer();
    longPressHandledRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressHandledRef.current = true;
      setMaterialListForOrders({ id: list.id, name: list.name });
      longPressTimerRef.current = null;
    }, 550);
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
              <Card
                key={list.id}
                {...merge.cardProps(list)}
                className={"card-lift relative cursor-pointer overflow-hidden" + merge.cardClassName(list)}
                onPointerDown={() => { if (!merge.active) startMaterialListLongPress(list); }}
                onPointerUp={clearLongPressTimer}
                onPointerLeave={clearLongPressTimer}
                onPointerCancel={clearLongPressTimer}
                onContextMenu={(event) => {
                  event.preventDefault();
                  clearLongPressTimer();
                  if (merge.active) return;
                  longPressHandledRef.current = true;
                  setMaterialListForOrders({ id: list.id, name: list.name });
                }}
                onClick={(event) => {
                  clearLongPressTimer();
                  if (merge.active) { merge.pick(list); return; }
                  if (longPressHandledRef.current) {
                    event.preventDefault();
                    longPressHandledRef.current = false;
                    return;
                  }
                  router.push(`/dashboard/material-lists/${list.id}`);
                }}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="line-clamp-2 min-w-0 leading-tight break-words">
                      {list.kind === "tools" && (
                        <WrenchIcon
                          className="text-muted-foreground mr-1.5 inline h-4 w-4 align-[-2px]"
                          aria-label="Tool request"
                        />
                      )}
                      {list.name}
                    </CardTitle>
                    {!merge.active && (canDeleteCoreRecords || canEditLists) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground -mt-1 -mr-2 h-9 w-9 shrink-0"
                            aria-label={`More actions for ${list.name}`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onContextMenu={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <MoreVerticalIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {canEditLists && <>
                            <DropdownMenuItem disabled={!isBrowserOnline || listsPending || duplicate.isPending || merge.isPending}
                              onSelect={() => duplicate.mutate({ materialListId: list.id })}>
                              <CopyIcon className="h-4 w-4" />Duplicate
                            </DropdownMenuItem>
                            {list.kind !== "tools" && <DropdownMenuItem disabled={!isBrowserOnline || listsPending || duplicate.isPending || merge.isPending}
                              onSelect={() => { merge.begin(list); }}>
                              <MergeIcon className="h-4 w-4" />Merge
                            </DropdownMenuItem>}
                          </>}
                          {canDeleteCoreRecords && <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                              setMaterialListToDelete({
                                id: list.id,
                                name: list.name,
                                itemCount: list.itemCount,
                              })
                            }
                          >
                            <TrashIcon className="h-4 w-4" />
                            Delete list
                          </DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <div className="flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <PackageIcon className="h-4 w-4" />
                      <span>
                        {list.itemCount}{" "}
                        {list.kind === "tools" ? "tool lines" : "items"}
                      </span>
                    </div>

                    {list.contributors && list.contributors.length > 0 && (
                      <div className="flex items-start gap-2">
                        {list.contributors.length > 1 ? (
                          <UsersIcon className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <UserIcon className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <span className="min-w-0 leading-snug">
                          {list.contributors
                            .map(formatContributorName)
                            .join(", ")}
                        </span>
                      </div>
                    )}
                    <MaterialListSendStatus
                      sentSupplierCount={list.sentSupplierCount}
                      totalSupplierCount={list.totalSupplierCount}
                      verifiedSupplierCount={list.verifiedSupplierCount}
                    />
                    <div className="mt-auto flex items-end justify-between gap-3 pt-1">
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="h-4 w-4" />
                        <span>
                          {format(new Date(list.createdAt), "MMM d, yyyy")}
                        </span>
                      </div>
                      <FinancialOnly>
                        {list.kind !== "tools" && (
                          <span className="shrink-0 font-semibold text-foreground tabular-nums">
                            ${list.materialTotal.toFixed(2)}
                          </span>
                        )}
                      </FinancialOnly>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="bg-background fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden">
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
