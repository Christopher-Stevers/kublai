"use client";

import { use, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useJobChatParentNavigation } from "~/hooks/use-job-chat-parent-navigation";
import { JobChatView } from "~/components/app/DeferredFeatures";
import { setLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";

export default function JobChatPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId: parameter } = use(params);
  const pathname = usePathname();
  const jobId =
    /^\/dashboard\/jobs\/([^/?#]+)/.exec(pathname)?.[1] ?? parameter;
  useJobChatParentNavigation(jobId);
  useEffect(() => {
    setLastJobWorkspaceLocation({ jobId, view: "chat", materialListId: null });
  }, [jobId]);
  return (
    <div className="mx-auto max-w-5xl px-2 py-3 sm:px-6">
      <JobChatView key={jobId} jobId={jobId} />
    </div>
  );
}
