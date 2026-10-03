"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  HEADER_BACK_REQUEST_EVENT,
  setHeaderBackVisible,
} from "~/lib/header-back-events";
import { setLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";

/** A push notification may open Chat without a previous page in this window. */
export function useJobChatParentNavigation(jobId: string) {
  const router = useRouter();
  useEffect(() => {
    const backToJob = () => {
      setLastJobWorkspaceLocation({
        jobId,
        view: "options",
        materialListId: null,
      });
      router.push(`/dashboard/jobs/${encodeURIComponent(jobId)}`);
    };
    setHeaderBackVisible(true);
    window.addEventListener(HEADER_BACK_REQUEST_EVENT, backToJob);
    // Do not intercept popstate: browser back/forward keep their real history.
    return () => {
      window.removeEventListener(HEADER_BACK_REQUEST_EVENT, backToJob);
      setHeaderBackVisible(false);
    };
  }, [jobId, router]);
}
