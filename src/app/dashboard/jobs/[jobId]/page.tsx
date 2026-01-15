"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  PlusIcon,
  PackageIcon,
  CalendarIcon,
  UserIcon,
  ArrowLeftIcon,
  MapPinIcon,
  PencilIcon,
} from "lucide-react";
import { format } from "date-fns";
import { JobEditDialog } from "~/components/jobs/JobEditDialog";

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  const router = useRouter();
  const utils = api.useUtils();
  const [showEditDialog, setShowEditDialog] = useState(false);

  // Get job details
  const { data: job, isLoading: jobLoading } = api.job.getJob.useQuery(
    { jobId },
    { enabled: !!jobId },
  );

  // Get material lists for this job
  const { data: materialLists, isLoading: listsLoading } =
    api.materialList.listMaterialLists.useQuery(
      { jobId },
      { enabled: !!jobId },
    );

  const createMaterialList = api.materialList.createMaterialList.useMutation({
    onSuccess: (data) => {
      void utils.materialList.listMaterialLists.invalidate();
      router.push(`/dashboard/material-lists/${data.materialListId}`);
    },
  });

  // Auto-create material list if job exists but no material lists
  useEffect(() => {
    if (
      job?.id &&
      !listsLoading &&
      materialLists &&
      materialLists.length === 0 &&
      !createMaterialList.isPending
    ) {
      createMaterialList.mutate({ jobId: job.id });
    }
  }, [job?.id, listsLoading, materialLists, createMaterialList, jobId]);

  const handleCreateNew = () => {
    if (job?.id) {
      createMaterialList.mutate({ jobId: job.id });
    }
  };

  const isLoading = jobLoading || listsLoading;

  if (isLoading) {
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
            <Button onClick={() => router.push("/dashboard")}>
              <ArrowLeftIcon className="mr-2 h-4 w-4" />
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
        {/* Back Button */}
        <Button
          variant="ghost"
          onClick={() => router.push("/dashboard")}
          className="mb-6"
        >
          <ArrowLeftIcon className="mr-2 h-4 w-4" />
          Back to Jobs
        </Button>

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
            {job.location && (
              <div className="flex items-center gap-2">
                <MapPinIcon className="h-4 w-4" />
                <span>{job.location.name}</span>
              </div>
            )}
            {job.foreman && (
              <div className="flex items-center gap-2">
                <UserIcon className="h-4 w-4" />
                <span>{job.foreman.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="font-medium">Status:</span>
              <span className="capitalize">{job.status}</span>
            </div>
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
                  <CardTitle className="line-clamp-1">{list.name}</CardTitle>
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
        />
      </div>
    </div>
  );
}

