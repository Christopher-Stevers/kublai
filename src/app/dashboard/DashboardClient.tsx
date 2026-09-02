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
  CheckCircle2Icon,
  FileTextIcon,
  UserIcon,
  MapPinIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  ShoppingCartIcon,
  TrashIcon,
  WifiOffIcon,
} from "lucide-react";
import { format } from "date-fns";
import {
  useReplicacheJobDetail,
  useReplicacheJobsList,
} from "~/hooks/use-replicache-jobs";
import { useReplicacheMaterialList } from "~/hooks/use-replicache-material-list";
import { useReplicacheSuppliers } from "~/hooks/use-replicache-suppliers";
import { MaterialListItem } from "~/components/materialLists/MaterialListItem";
import { MaterialListTableRow } from "~/components/materialLists/MaterialListTableRow";
import { AddPartDialog } from "~/components/materialLists/AddPartDialog";
import { QuotePreviewSheet } from "~/components/materialLists/QuotePreviewSheet";
import { OrdersPreviewSheet } from "~/components/materialLists/OrdersPreviewSheet";
import { ExistingQuotesOrdersDialog } from "~/components/materialLists/ExistingQuotesOrdersDialog";
import { JobEditDialog } from "~/components/jobs/JobEditDialog";
import { JobRoomsView } from "~/components/jobs/JobRoomsView";
import { JobWorkspaceOptions } from "~/components/jobs/JobWorkspaceOptions";
import {
  clearLastJobWorkspaceLocation,
  getLastJobWorkspaceLocation,
  setLastJobWorkspaceLocation,
  type JobWorkspaceView,
} from "~/lib/job-workspace-last-option";
import { MaterialListNameModal } from "~/components/materialLists/MaterialListNameModal";
import { ViewToggle } from "~/components/ui/view-toggle";
import {
  getBrowserOnlineStatus,
  useOnlineStatus,
} from "~/hooks/use-online-status";
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
    location.name ||
    null
  );
}

function getSendStatusTone(
  sentSupplierCount: number,
  totalSupplierCount: number,
) {
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
          <div className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700">
            <CheckCircle2Icon className="h-3.5 w-3.5 text-gray-500" />
            <span>
              {normalizedVerifiedCount}/{normalizedSentCount} verified
            </span>
          </div>
        )}
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

function formatContributorName(contributor: {
  name: string | null;
  email: string | null;
}) {
  return contributor.name?.trim() || contributor.email?.trim() || "Unknown";
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

export function DashboardClient({
  initialJobs,
}: {
  initialJobs: DashboardJob[];
}) {
  const router = useRouter();
  const hasRedirectedRef = useRef(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newJobName, setNewJobName] = useState("");
  const [showOfflineJobEditDialog, setShowOfflineJobEditDialog] =
    useState(false);
  const [
    showOfflineMaterialListNameModal,
    setShowOfflineMaterialListNameModal,
  ] = useState(false);
  const [offlineMaterialListViewMode, setOfflineMaterialListViewMode] =
    useState<"grid" | "table">("grid");
  const [showOfflineQuoteSheet, setShowOfflineQuoteSheet] = useState(false);
  const [showOfflineOrdersSheet, setShowOfflineOrdersSheet] = useState(false);
  const [showOfflineExistingQuotesDialog, setShowOfflineExistingQuotesDialog] =
    useState(false);
  const [selectedOfflineQuoteId, setSelectedOfflineQuoteId] = useState<
    string | undefined
  >();
  const [jobToDelete, setJobToDelete] = useState<{
    id: string;
    name: string;
    materialListCount?: number | null;
  } | null>(null);
  const [materialListToDelete, setMaterialListToDelete] = useState<{
    id: string;
    name: string;
    itemCount?: number | null;
  } | null>(null);
  const [offlineJobId, setOfflineJobId] = useState<string | null>(null);
  const [offlineMaterialListId, setOfflineMaterialListId] = useState<
    string | null
  >(null);
  const [offlineJobView, setOfflineJobView] =
    useState<JobWorkspaceView>("options");
  const [hasRestoredJobLocation, setHasRestoredJobLocation] = useState(false);
  const [forceOfflineView, setForceOfflineView] = useState(false);
  const [showOfflineAddPartDialog, setShowOfflineAddPartDialog] =
    useState(false);
  const isBrowserOnline = useOnlineStatus();
  const shouldUseLocalWorkspaceView =
    forceOfflineView || offlineJobId !== null || !isBrowserOnline;

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
  const offlineMaterialListDetail = useReplicacheMaterialList(
    offlineMaterialListId ?? "",
  );
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

  useEffect(() => {
    const last = getLastJobWorkspaceLocation();
    if (last) {
      setForceOfflineView(true);
      setOfflineJobId(last.jobId);
      setOfflineJobView(last.view);
      setOfflineMaterialListId(last.materialListId);
    }
    setHasRestoredJobLocation(true);
  }, []);

  useEffect(() => {
    if (!hasRestoredJobLocation) return;
    if (!offlineJobId) {
      clearLastJobWorkspaceLocation();
      return;
    }
    setLastJobWorkspaceLocation({
      jobId: offlineJobId,
      view: offlineJobView,
      materialListId: offlineMaterialListId,
    });
  }, [
    hasRestoredJobLocation,
    offlineJobId,
    offlineJobView,
    offlineMaterialListId,
  ]);

  const openJob = (jobId: string) => {
    setForceOfflineView(true);
    setOfflineJobId(jobId);
    setOfflineMaterialListId(null);
    setOfflineJobView("options");
  };

  const handleCreateJob = () => {
    if (newJobName.trim()) {
      const jobId = crypto.randomUUID();
      void mutateMaterialListAndSync(
        getMaterialListReplicache().mutate.createJob({
          jobId,
          name: newJobName.trim(),
        }),
      );
      setShowCreateDialog(false);
      setNewJobName("");
      setForceOfflineView(true);
      setOfflineJobId(jobId);
      setOfflineMaterialListId(null);
      setOfflineJobView("options");
    }
  };

  const handleCreateMaterialList = (jobId: string) => {
    const materialListId = crypto.randomUUID();
    const existingNames =
      offlineJobDetail?.job?.id === jobId
        ? offlineJobDetail.materialLists.map((list) => list.name)
        : [];
    void mutateMaterialListAndSync(
      getMaterialListReplicache().mutate.createMaterialList({
        materialListId,
        jobId,
        name: getNextMaterialListNameFromNames(existingNames),
      }),
    );

    setForceOfflineView(true);
    setOfflineJobId(jobId);
    setOfflineMaterialListId(materialListId);
  };

  const handleConfirmDeleteJob = () => {
    if (!jobToDelete || !canDeleteCoreRecords) return;
    const { id } = jobToDelete;
    setJobToDelete(null);
    void mutateMaterialListAndSync(
      getMaterialListReplicache().mutate.deleteJob({ jobId: id }),
    );
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

  const handleLocalWorkspaceBack = useCallback(() => {
    if (offlineMaterialListId) {
      setOfflineMaterialListId(null);
      setOfflineJobView("material-lists");
      return;
    }

    if (offlineJobView === "material-lists" || offlineJobView === "rooms") {
      setOfflineJobView("options");
      return;
    }

    setOfflineJobId(null);
    setForceOfflineView(!getBrowserOnlineStatus());
  }, [offlineJobView, offlineMaterialListId]);

  useEffect(() => {
    const showBackButton = Boolean(offlineJobId && shouldUseLocalWorkspaceView);
    setHeaderBackVisible(showBackButton);

    if (!showBackButton) {
      return () => setHeaderBackVisible(false);
    }

    const handleHeaderBackRequest = () => {
      handleLocalWorkspaceBack();
    };

    window.addEventListener(HEADER_BACK_REQUEST_EVENT, handleHeaderBackRequest);

    return () => {
      window.removeEventListener(
        HEADER_BACK_REQUEST_EVENT,
        handleHeaderBackRequest,
      );
      setHeaderBackVisible(false);
    };
  }, [handleLocalWorkspaceBack, offlineJobId, shouldUseLocalWorkspaceView]);

  if (hasFetchedUser && userData && !userData.organizationId) return null;

  if (offlineJobId && shouldUseLocalWorkspaceView) {
    const fallbackJob = jobs.find((job) => job.id === offlineJobId) ?? null;
    const offlineJob = offlineJobDetail?.job ?? fallbackJob;
    const offlineMaterialLists = offlineJobDetail?.materialLists ?? [];
    const selectedMaterialList = offlineMaterialListDetail.materialList;
    const selectedItems = offlineMaterialListDetail.items;
    const selectedMaterialTotal = offlineMaterialListDetail.materialTotal;
    const selectedMaterialListHasPendingSync =
      Boolean(selectedMaterialList?.pendingSync) ||
      selectedItems.some((item) => Boolean(item.pendingSync));
    const jobLocationAddress = formatLocationAddress(offlineJob?.location);
    const canGenerateDocuments =
      userData?.permissions.canGenerateDocuments ?? true;
    const offlineGenerationBlockReason = !isBrowserOnline
      ? "Reconnect before generating quotes or orders."
      : !canGenerateDocuments
        ? "Standard accounts cannot generate quotes or orders."
        : selectedMaterialListHasPendingSync
          ? "Finish syncing this material list before generating a quote or order."
          : selectedItems.length === 0
            ? "Add parts before generating a quote or order."
            : null;
    const canGenerateOfflineQuoteOrOrder = !offlineGenerationBlockReason;

    const handleOfflineGenerateQuote = () => {
      if (!canGenerateOfflineQuoteOrOrder) return;
      setShowOfflineExistingQuotesDialog(true);
    };

    const handleOfflineGenerateOrder = () => {
      if (!canGenerateOfflineQuoteOrOrder) return;
      setShowOfflineOrdersSheet(true);
    };

    const handleOfflineGenerateNewQuote = () => {
      setSelectedOfflineQuoteId(undefined);
      setShowOfflineQuoteSheet(true);
    };

    return (
      <div className="px-4 pt-6 pb-24 sm:px-6 sm:py-8">
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
                <div className="mb-6 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h1 className="min-w-0 text-2xl font-bold break-words text-gray-900 sm:text-3xl">
                        {selectedMaterialList.name}
                      </h1>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setShowOfflineMaterialListNameModal(true)
                        }
                        className="h-8 w-8 shrink-0"
                        aria-label="Edit material list"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <ViewToggle
                    view={offlineMaterialListViewMode}
                    onViewChange={setOfflineMaterialListViewMode}
                    showOnMobile
                  />
                </div>

                {selectedItems.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
                      <h3 className="mb-2 text-lg font-semibold">
                        No items yet
                      </h3>
                      <p className="text-muted-foreground mb-4 text-center">
                        Add parts now. They’ll stay on this device and sync when
                        online.
                      </p>
                      <Button onClick={() => setShowOfflineAddPartDialog(true)}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        Add Part
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {offlineMaterialListViewMode === "grid" ? (
                      <div className="grid grid-cols-2 gap-3 pb-24 sm:grid-cols-3 lg:grid-cols-4">
                        {selectedItems.map((item) => (
                          <MaterialListItem
                            key={item.id}
                            materialListId={selectedMaterialList.id}
                            suppliers={suppliers}
                            item={{
                              ...item,
                              selectedSupplierId: item.supplierId,
                              partDefinition: item.partDefinition ?? null,
                              supplierPart: item.supplierPart ?? null,
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="overflow-x-auto pb-24">
                        <table className="min-w-[52rem] divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                                Part
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                                Qty
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                                Unit
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                                Supplier
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                                Cost
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                                Total
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 bg-white">
                            {selectedItems.map((item) => (
                              <MaterialListTableRow
                                key={item.id}
                                materialListId={selectedMaterialList.id}
                                suppliers={suppliers}
                                item={{
                                  ...item,
                                  oneOff: null,
                                  uom: null,
                                  selectedSupplierId: item.supplierId,
                                  partDefinition: item.partDefinition ?? null,
                                  supplierPart: item.supplierPart ?? null,
                                }}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}

                <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white px-4 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:sticky sm:inset-x-auto sm:z-10 sm:-mx-6 sm:mt-4 sm:px-6 sm:pt-2">
                  <div className="mx-auto max-w-6xl">
                    <div className="space-y-1.5">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-base text-gray-600 sm:text-lg">
                          Material Total
                        </span>
                        <span className="text-base font-bold sm:text-lg">
                          ${selectedMaterialTotal.toFixed(2)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <Button
                          variant="outline"
                          onClick={handleOfflineGenerateQuote}
                          disabled={!canGenerateOfflineQuoteOrOrder}
                          title={
                            offlineGenerationBlockReason ?? "Generate quote"
                          }
                          className="h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs"
                        >
                          <FileTextIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                          <span className="text-center leading-tight">
                            Quote
                          </span>
                        </Button>
                        <Button
                          onClick={handleOfflineGenerateOrder}
                          disabled={!canGenerateOfflineQuoteOrOrder}
                          title={offlineGenerationBlockReason ?? "Order"}
                          className="h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs"
                        >
                          <ShoppingCartIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                          <span className="text-center leading-tight">
                            Order
                          </span>
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setShowOfflineAddPartDialog(true)}
                          className="h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs"
                        >
                          <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                          <span className="text-center leading-tight">
                            Add Part
                          </span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <AddPartDialog
                  open={showOfflineAddPartDialog}
                  onOpenChange={setShowOfflineAddPartDialog}
                  materialListId={selectedMaterialList.id}
                />
                {showOfflineQuoteSheet && (
                  <QuotePreviewSheet
                    open={showOfflineQuoteSheet}
                    onOpenChange={(open) => {
                      setShowOfflineQuoteSheet(open);
                      if (!open) setSelectedOfflineQuoteId(undefined);
                    }}
                    materialListId={selectedMaterialList.id}
                    jobName={offlineJob?.name ?? ""}
                    quoteId={selectedOfflineQuoteId}
                  />
                )}
                {showOfflineOrdersSheet && (
                  <OrdersPreviewSheet
                    open={showOfflineOrdersSheet}
                    onOpenChange={setShowOfflineOrdersSheet}
                    materialListId={selectedMaterialList.id}
                  />
                )}
                <ExistingQuotesOrdersDialog
                  open={showOfflineExistingQuotesDialog}
                  onOpenChange={setShowOfflineExistingQuotesDialog}
                  materialListId={selectedMaterialList.id}
                  type="quote"
                  onGenerateNew={handleOfflineGenerateNewQuote}
                  onOpenExisting={(quoteId) => {
                    setSelectedOfflineQuoteId(quoteId);
                    setShowOfflineQuoteSheet(true);
                  }}
                />
              </>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
                  <h3 className="mb-2 text-lg font-semibold">
                    Material list not cached
                  </h3>
                  <p className="text-muted-foreground text-center">
                    Reconnect once to cache this material list on this device.
                  </p>
                </CardContent>
              </Card>
            )
          ) : offlineJob ? (
            <>
              <div className="mb-6">
                <div className="mb-2 flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                    {offlineJob.name}
                  </h1>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowOfflineJobEditDialog(true)}
                    className="h-8 w-8 p-0"
                    aria-label="Edit job"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </Button>
                </div>
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

              {offlineJobView === "options" ? (
                <JobWorkspaceOptions
                  materialListCount={offlineMaterialLists.length}
                  onSelect={(optionId) => {
                    setOfflineJobView(optionId);
                  }}
                />
              ) : offlineJobView === "rooms" ? (
                <JobRoomsView jobId={offlineJob.id} />
              ) : (
                <>
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    Material Lists
                  </h2>
                  {offlineMaterialLists.length === 0 && (
                    <p className="text-muted-foreground mt-1 text-sm">
                      Create and manage material lists offline. New lists sync
                      when reconnected.
                    </p>
                  )}
                </div>
                {offlineMaterialLists.length === 0 && (
                  <Button
                    onClick={() => handleCreateMaterialList(offlineJob.id)}
                    size="lg"
                    className="h-11 w-full sm:w-auto"
                  >
                    <PlusIcon className="mr-2 h-5 w-5" />
                    New Material List
                  </Button>
                )}
                {offlineMaterialLists.length > 0 && (
                  <Button
                    onClick={() => handleCreateMaterialList(offlineJob.id)}
                    size="lg"
                    className="hidden h-11 sm:inline-flex sm:w-auto"
                  >
                    <PlusIcon className="mr-2 h-5 w-5" />
                    New Material List
                  </Button>
                )}
              </div>

              {offlineMaterialLists.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
                    <h3 className="mb-2 text-lg font-semibold">
                      No material lists yet
                    </h3>
                    <p className="text-muted-foreground mb-4 text-center">
                      Create one now. It’ll stay on this device and sync when
                      online.
                    </p>
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
                        <div className="flex items-start justify-between gap-3">
                          <CardTitle className="line-clamp-2 min-w-0 leading-tight break-words">
                            {list.name}
                          </CardTitle>
                          {canDeleteCoreRecords && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="-mt-3 -mr-3 h-10 w-10 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                              aria-label={`Delete material list ${list.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
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
                          {list.contributors &&
                            list.contributors.length > 0 && (
                              <div className="flex items-start gap-2">
                                <UserIcon className="mt-0.5 h-4 w-4 shrink-0" />
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

              {offlineMaterialLists.length > 0 && (
                <div className="bg-background fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden">
                  <Button
                    onClick={() => handleCreateMaterialList(offlineJob.id)}
                    size="lg"
                    className="h-12 w-full"
                  >
                    <PlusIcon className="mr-2 h-5 w-5" />
                    New Material List
                  </Button>
                </div>
              )}
                </>
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

          {offlineJob && (
            <JobEditDialog
              open={showOfflineJobEditDialog}
              onOpenChange={setShowOfflineJobEditDialog}
              jobId={offlineJob.id}
              initialName={offlineJob.name}
              initialLocationId={offlineJob.locationId}
              initialForemanName={offlineJob.foremanName ?? null}
              initialPoNumber={offlineJob.poNumber ?? null}
            />
          )}

          {selectedMaterialList && (
            <MaterialListNameModal
              open={showOfflineMaterialListNameModal}
              onOpenChange={setShowOfflineMaterialListNameModal}
              materialListId={selectedMaterialList.id}
              initialName={selectedMaterialList.name ?? null}
            />
          )}

          <Dialog
            open={!!materialListToDelete}
            onOpenChange={(open) => {
              if (!open) setMaterialListToDelete(null);
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
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              Dashboard
            </h1>
            <p className="text-muted-foreground mt-2 text-sm sm:text-base">
              Select a job to open it
            </p>
          </div>
          <Button
            onClick={() => setShowCreateDialog(true)}
            size="lg"
            className={`h-11 w-full sm:w-auto ${jobs.length > 0 ? "hidden sm:inline-flex" : ""}`}
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

        {!isWaitingForJobs && jobs.length > 0 && (
          <div className="bg-background fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden">
            <Button
              onClick={() => setShowCreateDialog(true)}
              size="lg"
              className="h-12 w-full"
            >
              <PlusIcon className="mr-2 h-5 w-5" />
              Add Job
            </Button>
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
              <Button onClick={handleCreateJob} disabled={!newJobName.trim()}>
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

        <Dialog
          open={!!materialListToDelete}
          onOpenChange={(open) => {
            if (!open) setMaterialListToDelete(null);
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
