"use client";

import { use } from "react";

import { JobDrawsView } from "~/components/draws/JobDrawsView";

export default function JobDrawsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <JobDrawsView jobId={jobId} />
      </div>
    </div>
  );
}
