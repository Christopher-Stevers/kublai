"use client";
import { JobActivityPanels } from "~/components/jobs/JobActivityPanels";
import { PressableCard } from "~/components/ui/pressable-card";
import { prepareJourney } from "~/routes/registry";
import { PriorityActionBar } from "~/components/ui/priority-action-bar";
import { JobOverviewHeading } from "~/components/jobs/JobOverviewHeading";
import { JobOfflineNotice } from "~/components/jobs/JobOfflineNotice";
import { formatLocationAddress, type JobLocationDisplay } from "~/lib/location-address";
import { useScrollToTop } from "~/hooks/use-remembered-scroll";
import { PageHeader } from "~/components/ui/page-header";

import { DeferredJobModelsView } from "~/components/models/DeferredJobModelsView";
import { JobRoomsView, JobDrawingsView, JobDocumentsView, JobSystemsView, JobChatView } from "~/components/app/DeferredFeatures";

import { JobMaterialListsView } from "~/components/materialLists/JobMaterialListsView";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "~/trpc/react";
import { EmptyState } from "~/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,  } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { BriefcaseIcon, UserIcon, MapPinIcon, MoreVerticalIcon, PackageIcon, PlusIcon, TrashIcon, } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Badge } from "~/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,  } from "~/components/ui/dropdown-menu";
import { useReplicacheJobDetail, useReplicacheJobsList,  } from "~/hooks/use-replicache-jobs";
import { MaterialListScreen } from "~/components/app/DeferredFeatures";
import { JobEditDialog } from "~/components/app/DeferredFeatures";
import { JobWorkspaceOptions } from "~/components/jobs/JobWorkspaceOptions";
import { useJobRoomCount } from "~/hooks/use-job-room-count";
import { useJobWorkspaceNavigation } from "~/hooks/use-job-workspace-navigation";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useWorkspaceMutations } from "~/hooks/use-workspace-mutations";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { HEADER_BACK_REQUEST_EVENT, setHeaderBackVisible,  } from "~/lib/header-back-events";
import { Skeleton } from "~/components/ui/skeleton";



export type JobsJob = {
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
  lastActivityAt?: string | null;
};

// Draft is the default state, so only later stages get a badge.
const jobStatusLabels: Record<string, string> = {
  quoted: "Quoted",
  ordered: "Ordered",
  completed: "Completed",
};

export function JobsClient({
  initialJobs,
}: {
  initialJobs: JobsJob[];
}) {
  const { getReplicache: getMaterialListReplicache, mutateAndSync: mutateMaterialListAndSync } = useWorkspaceMutations();
  const sandbox = useTutorialSandbox();
  const router = useRouter();
  const hasRedirectedRef = useRef(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newJobName, setNewJobName] = useState("");
  const [showOfflineJobEditDialog, setShowOfflineJobEditDialog] =
    useState(false);
  const [jobToDelete, setJobToDelete] = useState<{
    id: string;
    name: string;
    materialListCount?: number | null;
  } | null>(null);
  const {
    location: workspaceLocation,
    navigate: navigateWorkspace,
    back: handleLocalWorkspaceBack,
  } = useJobWorkspaceNavigation();
  const offlineJobId = workspaceLocation?.jobId ?? null;
  const offlineMaterialListId = workspaceLocation?.materialListId ?? null;
  const offlineJobView = workspaceLocation?.view ?? "options";
  const isBrowserOnline = useOnlineStatus();
  const roomCount = useJobRoomCount(offlineJobId, offlineJobView === "options");

  const { data: chatOverview } = api.chat.getOverview.useQuery({ jobId: offlineJobId ?? "" }, {
    enabled: isBrowserOnline && Boolean(offlineJobId) && offlineJobView === "options",
    refetchInterval: 30_000, refetchIntervalInBackground: false,
  });

  // Check user's organizationId status
  const { data: userData, isFetched: hasFetchedUser } =
    api.user.getMyRole.useQuery(undefined, {
      enabled: isBrowserOnline,
      refetchOnMount: true,
      refetchOnWindowFocus: false,
    });
  const can = userData?.permissions.can;
  const canCreateJobs = !!sandbox || !!can?.["jobs.create"];
  const canDeleteJobs = !sandbox && (can?.["jobs.delete"] ?? true);

  // Redirect to onboarding if user has no organizationId
  useEffect(() => {
    if (sandbox || hasRedirectedRef.current) {
      return;
    }

    if (hasFetchedUser && userData && !userData.organizationId) {
      if (typeof window !== "undefined") {
        hasRedirectedRef.current = true;
        window.location.href = "/onboarding";
      }
    }
  }, [hasFetchedUser, hasRedirectedRef, userData, sandbox]);

  const replicacheJobs = useReplicacheJobsList();
  const offlineJobDetail = useReplicacheJobDetail(
    offlineMaterialListId ? "" : offlineJobId ?? "",
    offlineJobView === "material-lists",
  );
  useScrollToTop(
    sandbox ? null : !offlineJobId ? "jobs"
      : offlineJobView === "options" && !offlineMaterialListId ? `job:${offlineJobId}` : null,
  );
  const jobs = sandbox || replicacheJobs.length > 0 ? replicacheJobs : initialJobs;
  const isWaitingForJobs = false;

  useEffect(() => {
    if (sandbox || !isBrowserOnline || jobs.length === 0) return;

    // Warm the App Router/RSC cache while online so tapping a job can work
    // after the device loses connectivity.
    for (const job of jobs.slice(0, 50)) {
      router.prefetch(`/jobs/${job.id}`);
    }
  }, [isBrowserOnline, jobs, router, sandbox]);

  const openJob = (jobId: string) => {
    navigateWorkspace({ jobId, view: "options", materialListId: null });
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
      openJob(jobId);
    }
  };

  const handleConfirmDeleteJob = () => {
    if (!jobToDelete || !canDeleteJobs) return;
    const { id } = jobToDelete;
    setJobToDelete(null);
    void mutateMaterialListAndSync(
      getMaterialListReplicache().mutate.deleteJob({ jobId: id }),
    );
  };

  useEffect(() => {
    const showBackButton = Boolean(offlineJobId);
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
  }, [handleLocalWorkspaceBack, offlineJobId]);

  if (!sandbox && hasFetchedUser && userData && !userData.organizationId) return null;

  // Retain only reviewed local workspace screens. External editors and model/
  // systems workflows keep their existing lifecycle until save cleanup is audited.
  const retainPanel = (screen: ReactNode) => {
    const reviewed = offlineJobId !== null && (Boolean(offlineMaterialListId) ||
      ["options", "material-lists", "tool-requests", "rooms", "drawings", "chat"].includes(offlineJobView));
    if (!reviewed) return screen;
    return (
      <JobActivityPanels
        key={offlineJobId}
        activeKey={offlineMaterialListId ? `list:${offlineMaterialListId}` : `view:${offlineJobView}`}
      >
        {screen}
      </JobActivityPanels>
    );
  };

  if (offlineJobId && !offlineMaterialListId && offlineJobView === "chat") {
    return retainPanel(<JobChatView key={offlineJobId} jobId={offlineJobId} />);
  }

  // Tutorial and live lists share rendering; the sandbox supplies isolated data.
  if (offlineMaterialListId) {
    return retainPanel(<MaterialListScreen key={offlineMaterialListId} id={offlineMaterialListId} embedded />);
  }

  if (offlineJobId) {
    const fallbackJob = jobs.find((job) => job.id === offlineJobId) ?? null;
    const offlineJob = offlineJobDetail?.job ?? fallbackJob;

    return retainPanel(
      <div className="px-4 pt-6 pb-24 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          {!isBrowserOnline && <JobOfflineNotice />}

          {offlineJob ? (
            <>
              {/* Job details only on the job overview, not inside Rooms or Material Lists. */}
              {offlineJobView === "options" && (
                <JobOverviewHeading job={offlineJob} onEdit={() => setShowOfflineJobEditDialog(true)} />
              )}

              {offlineJobView === "options" ? (
                <JobWorkspaceOptions
                  jobId={sandbox ? undefined : offlineJobId}
                  materialListCount={offlineJobDetail?.materialLists.length ?? 0}
                  roomCount={roomCount.count}
                  roomCountLoading={roomCount.loading}
                  chatUnreadCount={chatOverview?.unreadCount}
                  onSelect={(optionId) => {
                    navigateWorkspace({
                      jobId: offlineJobId,
                      view: optionId,
                      materialListId: null,
                    });
                  }}
                />
              ) : offlineJobView === "documents" ? (
                <JobDocumentsView key={offlineJob.id} jobId={offlineJob.id} />
              ) : offlineJobView === "systems" ? (
                <JobSystemsView key={offlineJob.id} jobId={offlineJob.id} />
              ) : offlineJobView === "models" ? (
                <DeferredJobModelsView jobId={offlineJob.id} />
              ) : offlineJobView === "drawings" ? (
                <JobDrawingsView jobId={offlineJob.id} />
              ) : offlineJobView === "rooms" ? (
                <JobRoomsView jobId={offlineJob.id} onOpenMaterialList={(materialListId) =>
                  navigateWorkspace({ jobId: offlineJob.id, view: "material-lists", materialListId })
                } onOpenDrawings={() =>
                  navigateWorkspace({ jobId: offlineJob.id, view: "drawings", materialListId: null })
                } />
              ) : (
                <JobMaterialListsView
                  jobId={offlineJob.id}
                  lists={offlineJobDetail?.materialLists}
                  onOpen={(materialListId) =>
                    navigateWorkspace({ jobId: offlineJob.id, view: "material-lists", materialListId })
                  }
                />
              )}
            </>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BriefcaseIcon className="mb-4 h-12 w-12 text-muted-foreground/70" />
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





        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        {!isBrowserOnline && <JobOfflineNotice />}
        <PageHeader
          title="Jobs"
          description="Select a job to open it"
          actions={canCreateJobs && (
            <Button
              onClick={() => setShowCreateDialog(true)}
              size="lg"
              className={`h-11 w-full sm:w-auto ${jobs.length > 0 ? "hidden sm:inline-flex" : ""}`}
            >
              <PlusIcon className="mr-2 h-5 w-5" />
              Add Job
            </Button>
          )}
        />

        {isWaitingForJobs ? (
          <div
            role="status"
            aria-label="Loading jobs"
            data-workspace-loading
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {[0, 1, 2].map((index) => (
              <Card key={index} className="gap-3 py-4">
                <CardHeader className="px-4">
                  <Skeleton className="h-6 w-2/3" />
                </CardHeader>
                <CardContent className="space-y-2 px-4">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="mt-3 h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                art="hardhat"
                title="No jobs yet. Create your first job to get started."
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => {
              const lastActivity =
                "lastActivityAt" in job && job.lastActivityAt
                  ? job.lastActivityAt
                  : job.createdAt;
              const statusLabel = jobStatusLabels[job.status];
              return (
                <PressableCard
                  key={job.id}
                  prepare={signal => { if (!sandbox) void prepareJourney("openjob", { jobId: job.id }, signal); }}
                  data-tutorial="job-card"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openJob(job.id); }
                  }}
                  className="group hover:border-primary/40 cursor-pointer gap-3 py-4 transition-[box-shadow,border-color] hover:shadow-md"
                  onClick={() => openJob(job.id)}
                >
                  <CardHeader className="px-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="line-clamp-2 text-base leading-snug sm:text-lg">
                          {job.name}
                        </CardTitle>
                        {statusLabel && (
                          <Badge variant="secondary" className="mt-1.5">
                            {statusLabel}
                          </Badge>
                        )}
                      </div>
                      {canDeleteJobs && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground -mt-1 -mr-2 h-9 w-9 shrink-0"
                              aria-label={`More actions for ${job.name}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVerticalIcon className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                setJobToDelete({
                                  id: job.id,
                                  name: job.name,
                                  materialListCount: job.materialListCount,
                                })
                              }
                            >
                              <TrashIcon className="h-4 w-4" />
                              Delete job
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="px-4">
                    <div className="text-muted-foreground space-y-1.5 text-sm">
                      {job.location && (
                        <div className="flex items-center gap-2">
                          <MapPinIcon className="h-4 w-4 shrink-0" />
                          <span className="line-clamp-1">
                            {formatLocationAddress(job.location)}
                          </span>
                        </div>
                      )}
                      {job.foremanName && (
                        <div className="flex items-center gap-2">
                          <UserIcon className="h-4 w-4 shrink-0" />
                          <span className="line-clamp-1">{job.foremanName}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-muted-foreground mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs">
                      <span className="text-foreground inline-flex items-center gap-1.5 font-medium">
                        <PackageIcon className="text-primary h-4 w-4" />
                        {job.materialListCount ?? 0}{" "}
                        {job.materialListCount === 1 ? "list" : "lists"}
                      </span>
                      <span title={format(new Date(lastActivity), "PPp")}>
                        Updated{" "}
                        {formatDistanceToNow(new Date(lastActivity), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </CardContent>
                </PressableCard>
              );
            })}
          </div>
        )}

        {canCreateJobs && !isWaitingForJobs && jobs.length > 0 && (
          <div className="bg-background fixed inset-x-0 bottom-0 z-40 pin-viewport-bottom border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden">
            <PriorityActionBar>
            <Button
              onClick={() => setShowCreateDialog(true)}
              size="lg"
              className="h-12 w-full"
            >
              <PlusIcon className="mr-2 h-5 w-5" />
              Add Job
            </Button>
            </PriorityActionBar>
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

      </div>
    </div>
  );
}
