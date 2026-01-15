"use client";

import { useRouter } from "next/navigation";
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

  // Get all jobs
  const { data: jobs, isLoading } = api.job.listJobs.useQuery();

  if (isLoading) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading jobs...</p>
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
                        <span className="line-clamp-1">{job.location.name}</span>
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
