"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  BriefcaseIcon,
  CalendarIcon,
  UserIcon,
  MapPinIcon,
  PackageIcon,
} from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const router = useRouter();
  const utils = api.useUtils();
  const hasAttemptedCreate = useRef(false);
  const jobsWithMaterialListsCreated = useRef<Set<string>>(new Set());
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasRedirectedRef = useRef(false);

  // Check user's organizationId status
  const { data: userData, isLoading: isLoadingUser } =
    api.user.getMyRole.useQuery(undefined, {
      refetchOnMount: true,
      refetchOnWindowFocus: false,
    });

  // Redirect to onboarding if user has no organizationId
  // This is a fallback in case server-side redirect didn't work
  useEffect(() => {
    if (hasRedirectedRef.current) {
      return;
    }

    // If we have user data and no organizationId, redirect immediately
    if (userData && !userData.organizationId) {
      if (typeof window !== 'undefined') {
        hasRedirectedRef.current = true;
        window.location.href = "/onboarding";
      }
      return;
    }

    // If still loading after 2 seconds, redirect anyway
    if (isLoadingUser && !userData) {
      pollingTimeoutRef.current = setTimeout(() => {
        if (!hasRedirectedRef.current && typeof window !== 'undefined') {
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

  // Get all jobs
  const { data: jobs, isLoading } = api.job.listJobs.useQuery();

  // Create material list mutation
  const createMaterialList = api.materialList.createMaterialList.useMutation({
    onSuccess: (_, variables) => {
      void utils.job.listJobs.invalidate();
      // Track that we've created a material list for this job
      if (variables.jobId) {
        jobsWithMaterialListsCreated.current.add(variables.jobId);
      }
    },
  });

  // Create job mutation
  const createJob = api.job.createJob.useMutation({
    onSuccess: (newJob) => {
      hasAttemptedCreate.current = false; // Reset on success
      void utils.job.listJobs.invalidate();
      // Auto-create material list for the new job
      if (newJob?.id) {
        createMaterialList.mutate({ jobId: newJob.id });
      }
    },
    onError: () => {
      hasAttemptedCreate.current = false; // Reset on error so user can retry
    },
  });

  // Auto-create a job if user has no jobs
  useEffect(() => {
    if (
      !isLoading &&
      (!jobs || jobs.length === 0) &&
      !createJob.isPending &&
      !hasAttemptedCreate.current
    ) {
      hasAttemptedCreate.current = true;
      createJob.mutate({ name: "New Job" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, jobs]);

  // Auto-create material lists for jobs that don't have any
  useEffect(() => {
    if (
      !isLoading &&
      jobs &&
      jobs.length > 0 &&
      !createMaterialList.isPending
    ) {
      // Find jobs without material lists that we haven't tried to create for yet
      const jobsNeedingMaterialLists = jobs.filter(
        (job) =>
          (job.materialListCount ?? 0) === 0 &&
          !jobsWithMaterialListsCreated.current.has(job.id),
      );

      // Create material list for the first job that needs one
      const jobToCreateFor = jobsNeedingMaterialLists[0];
      if (jobToCreateFor) {
        jobsWithMaterialListsCreated.current.add(jobToCreateFor.id);
        createMaterialList.mutate({ jobId: jobToCreateFor.id });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, jobs]);

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

  if (isLoading || createJob.isPending || createMaterialList.isPending) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">
              {createJob.isPending
                ? "Creating your first job..."
                : createMaterialList.isPending
                  ? "Creating material list..."
                  : "Loading jobs..."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            Dashboard
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Select a job to view and manage its material lists
          </p>
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
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => router.push(`/dashboard/jobs/${job.id}`)}
              >
                <CardHeader>
                  <CardTitle className="line-clamp-1">{job.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm text-gray-600">
                    {job.location && (
                      <div className="flex items-center gap-2">
                        <MapPinIcon className="h-4 w-4" />
                        <span className="line-clamp-1">
                          {job.location.name}
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
                      <span className="font-medium">Status:</span>
                      <span className="capitalize">{job.status}</span>
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
      </div>
    </div>
  );
}
